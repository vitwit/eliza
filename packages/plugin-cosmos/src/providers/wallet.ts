import { chains } from "chain-registry";
import NodeCache from "node-cache";
import BigNumber from "bignumber.js";
import { SigningStargateClient, StdFee } from "@cosmjs/stargate";
import { getOfflineSignerProto as getOfflineSigner } from "cosmjs-utils";
import {
  IAgentRuntime,
  Memory,
  Provider,
  State
} from "@ai16z/eliza";

/**
 * Minimal CosmosChainInfo shape for demonstration.
 * Extend as needed to match your usage.
 */
export interface CosmosChainInfo {
  chain_name: string;
  denom?: string;
  decimals?: number;
  coingecko_id: string;
  bech32_prefix: string;
  apis?: {
    rpc?: Array<{ address: string }>;
  };
  fees?: {
    fee_tokens?: Array<{
      denom: string;
      average_gas_price?: number;
    }>;
  };
}

/**
 * Basic token interface for the portfolio
 */
export interface CosmosToken {
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  uiAmount: string;
  priceUsd: string;
  valueUsd: string;
}

/**
 * Portfolio interface showing total USD plus an array of tokens
 */
interface WalletPortfolio {
  totalUsd: string;
  tokens: Array<CosmosToken>;
}

/**
 * Shared utility to connect to the Cosmos chain using a mnemonic and chainInfo.
 * Returns { stargateClient, signerAddress } for further usage (transfers, queries, etc.).
 */
export async function connectWallet(
  mnemonic: string,
  chainInfo: CosmosChainInfo
): Promise<{
  stargateClient: SigningStargateClient;
  signerAddress: string;
}> {
  if (!mnemonic) {
    throw new Error("Cosmos wallet mnemonic not provided");
  }

  // 1) Grab the first RPC endpoint
  const rpcUrl = chainInfo.apis?.rpc?.[0]?.address;
  if (!rpcUrl) {
    throw new Error("No RPC endpoint specified in chainInfo");
  }

  // 2) Create offline signer
  const signer = await getOfflineSigner({
    mnemonic,
    chain: chainInfo,
  });

  // 3) Connect Stargate client
  const stargateClient = await SigningStargateClient.connectWithSigner(
    rpcUrl,
    signer
  );

  // 4) Get the signer address
  const [account] = await signer.getAccounts();
  const signerAddress = account.address;

  return { stargateClient, signerAddress };
}

/**
 * The main WalletProvider class
 * - Connects to chain (via chain-registry or environment overrides)
 * - Stores the signer address
 * - Exposes getAddress() for external usage
 * - Provides getFormattedPortfolio(...) to retrieve portfolio info
 */
export class WalletProvider implements Provider {
  private cache: NodeCache;
  private stargateClient: SigningStargateClient | null = null;
  private signerAddress: string | null = null;

  constructor(
    private mnemonic: string,
    private chainInfo: CosmosChainInfo
  ) {
    console.log("WalletProvider instantiated for chain:", chainInfo.chain_name);
    this.cache = new NodeCache({ stdTTL: 300 }); // 5-min TTL
  }

  /**
   * Eliza's Provider interface method: fetch some data (portfolio, etc.)
   */
  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<string | null> {
    try {
      return await this.getFormattedPortfolio(runtime);
    } catch (error) {
      console.error("Error in wallet provider get():", error);
      return null;
    }
  }

  /**
   * Public method to establish the connection (once).
   */
  public async connectWallet(runtime: IAgentRuntime): Promise<void> {
    if (this.stargateClient && this.signerAddress) return;

    const { stargateClient, signerAddress } = await connectWallet(
      this.mnemonic,
      this.chainInfo
    );
    this.stargateClient = stargateClient;
    this.signerAddress = signerAddress;
  }

  /**
   * Public method to fetch the current signer address
   */
  public getAddress(): string | null {
    return this.signerAddress;
  }

  /**
   * Example: fetch a single-token portfolio, with price from Coingecko
   */
  async fetchPortfolioValue(runtime: IAgentRuntime): Promise<WalletPortfolio> {
    // In-memory caching for demonstration
    const cacheKey = `portfolio-${this.chainInfo.chain_name}`;
    const cachedValue = this.cache.get<WalletPortfolio>(cacheKey);
    if (cachedValue) {
      console.log("Cache hit for fetchPortfolioValue");
      return cachedValue;
    }

    // Make sure we're connected
    await this.connectWallet(runtime);
    if (!this.stargateClient || !this.signerAddress) {
      throw new Error("Unable to fetch balances - not connected");
    }

    // Denom & decimals from chainInfo
    const denom = this.chainInfo.denom;
    const decimals = this.chainInfo.decimals ?? 6;

    // Get balance
    const balances = await this.stargateClient.getAllBalances(this.signerAddress);
    const baseTokenBalance = balances.find((b) => b.denom === denom);
    const rawBalance = baseTokenBalance?.amount ?? "0";

    // Price from Coingecko
    const cgID = this.chainInfo.coingecko_id;
    const tokenPriceUsd = await this.fetchTokenPrice(cgID);

    // Convert minimal denom -> "1" denom
    const convertedBalance = new BigNumber(rawBalance).shiftedBy(-decimals);
    const valueUsd = convertedBalance.multipliedBy(tokenPriceUsd).toFixed();

    const portfolio: WalletPortfolio = {
      totalUsd: valueUsd,
      tokens: [
        {
          name: this.chainInfo.chain_name ?? "Cosmos Chain",
          symbol: denom?.toUpperCase() || "N/A",
          decimals,
          balance: rawBalance,
          uiAmount: convertedBalance.toString(),
          priceUsd: tokenPriceUsd.toString(),
          valueUsd,
        },
      ],
    };

    // Cache the result
    this.cache.set(cacheKey, portfolio);
    return portfolio;
  }

  /**
   * Example price fetcher from Coingecko
   */
  private async fetchTokenPrice(cgID: string): Promise<number> {
    const cacheKey = `price-${cgID}`;
    const cachedPrice = this.cache.get<number>(cacheKey);
    if (cachedPrice) {
      return cachedPrice;
    }

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgID}&vs_currencies=usd`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Error fetching price for ${cgID}. Status: ${response.status}`);
        return 0;
      }

      const data = await response.json();
      const price = data[cgID]?.usd ?? 0;
      this.cache.set(cacheKey, price);

      return price;
    } catch (error) {
      console.error("Error fetching token price:", error);
      return 0;
    }
  }

  /**
   * Format the portfolio into a text string
   */
  formatPortfolio(portfolio: WalletPortfolio): string {
    let output = `Chain: ${this.chainInfo.chain_name}\n`;

    if (this.signerAddress) {
      output += `Account Address: ${this.signerAddress}\n\n`;
    }

    const totalUsd = new BigNumber(portfolio.totalUsd).toFixed(2);
    output += `Total Value: $${totalUsd}\n\nToken Balances:\n`;

    for (const token of portfolio.tokens) {
      const valUsd = new BigNumber(token.valueUsd).toFixed(2);
      output += `${token.name} (${token.symbol}): ${token.uiAmount} ($${valUsd})\n`;
    }

    output += `\nMarket Prices:\n`;
    for (const token of portfolio.tokens) {
      const tokenPriceUsd = new BigNumber(token.priceUsd).toFixed(2);
      output += `${token.symbol}: $${tokenPriceUsd}\n`;
    }

    return output;
  }

  /**
   * Convenience method: fetch + format
   */
  async getFormattedPortfolio(runtime: IAgentRuntime): Promise<string> {
    try {
      const portfolio = await this.fetchPortfolioValue(runtime);
      return this.formatPortfolio(portfolio);
    } catch (error) {
      console.error("Error generating portfolio report:", error);
      return "Unable to fetch wallet information. Please try again later.";
    }
  }
}

/**
 * Single exported provider (default behavior for Eliza data fetch).
 * - If COSMOS_RPC_URL is set, we build a minimal chainInfo from environment.
 * - Otherwise, fallback to chain-registry for chain details.
 */
export const walletProvider: Provider = {
  get: async (runtime, message, state) => {
    try {
      // 1) Ensure mnemonic
      const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
      if (!mnemonic) {
        throw new Error("COSMOS_MNEMONIC not configured");
      }

      // 2) Prepare chainName & coingeckoID
      const chainName = runtime.getSetting("COSMOS_CHAIN_NAME") || "osmosis";
      const coingeckoID = runtime.getSetting("COSMOS_COINGECKO_ID") || "osmosis";

      // 3) Check if custom RPC is set
      const customRpc = runtime.getSetting("COSMOS_RPC_URL");
      if (customRpc) {
        // Build a minimal chainInfo object from environment
        const customDenom = runtime.getSetting("COSMOS_CHAIN_DENOM") || "uosmo";
        const customDecimals = Number(runtime.getSetting("COSMOS_CHAIN_DECIMALS") || 6);
        const bech32Prefix = runtime.getSetting("COSMOS_BECH32_PREFIX") || "osmo";

        const localChainInfo: CosmosChainInfo = {
          chain_name: chainName,
          bech32_prefix: bech32Prefix,
          coingecko_id: coingeckoID,
          apis: { rpc: [{ address: customRpc }] },
          denom: customDenom,
          decimals: customDecimals,
          fees: {
            fee_tokens: [
              {
                denom: customDenom,
                average_gas_price: 0.025,
              },
            ],
          },
        };

        const providerInstance = new WalletProvider(mnemonic, localChainInfo);
        return providerInstance.getFormattedPortfolio(runtime);
      } else {
        // Use chain-registry
        const chainData = chains.find((c) => c.chain_name === chainName);
        if (!chainData) {
          throw new Error(`Chain '${chainName}' not found in chain-registry`);
        }

        const chainDenom = chainData.fees?.fee_tokens?.[0]?.denom || "uosmo";
        const chainDecimals = chainData.decimals ?? 6;

        chainData.denom = chainDenom;
        chainData.decimals = chainDecimals;

        if (!chainData.coingecko_id) {
          chainData.coingecko_id = coingeckoID;
        }

        const providerInstance = new WalletProvider(
          mnemonic,
          chainData as CosmosChainInfo
        );
        return providerInstance.getFormattedPortfolio(runtime);
      }
    } catch (error) {
      console.error("Error in wallet provider:", error);
      return null;
    }
  },
};
