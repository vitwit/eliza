import {
    IAgentRuntime,
    Memory,
    Provider,
    State
  } from "@ai16z/eliza";
  import BigNumber from "bignumber.js";
  import NodeCache from "node-cache";
  import { chains } from "chain-registry";

  import {
    getOfflineSignerProto as getOfflineSigner,
  } from "cosmjs-utils";
  import { SigningStargateClient } from "@cosmjs/stargate";
  import { coins, StdFee } from "@cosmjs/amino";

  /**
   * Example chain registry interface (trimmed down).
   * You can mark fields as optional if some chains might omit them.
   */
  interface CosmosChainInfo {
    chain_name: string;
    status: string;
    network_type: string;
    website: string;
    pretty_name: string;
    chain_type: string;
    chain_id: string;
    bech32_prefix: string;
    daemon_name: string;
    node_home: string;
    key_algos: string[];
    slip44: number;
    fees: {
      fee_tokens: Array<{
        denom: string;
        fixed_min_gas_price: number;
        low_gas_price: number;
        average_gas_price: number;
        high_gas_price: number;
      }>;
    };
    staking: {
      staking_tokens: Array<{
        denom: string;
      }>;
      lock_duration: {
        time: string;
      };
    };
    images: Array<{
      image_sync: {
        chain_name: string;
        base_denom: string;
      };
      svg: string;
      png: string;
      theme: {
        primary_color_hex: string;
      };
    }>;
    description: string;
    apis: {
      rpc: Array<{
        address: string;
        provider: string;
      }>;
      rest: Array<{
        address: string;
        provider: string;
      }>;
      grpc: Array<{
        address: string;
        provider: string;
      }>;
    };

    /**
     * Custom convenience fields we add ourselves
     * (not in the chain-registry by default)
     */
    denom?: string;
    decimals?: number;
  }

  /**
   * Example token interface
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

  interface WalletPortfolio {
    totalUsd: string;
    tokens: Array<CosmosToken>;
  }

  export class WalletProvider implements Provider {
    private cache: NodeCache;
    private stargateClient: SigningStargateClient | null = null;
    private signerAddress: string | null = null;

    constructor(
      private mnemonic: string,
      private chainInfo: CosmosChainInfo,
    ) {
      // Cache with 5-min TTL
      this.cache = new NodeCache({ stdTTL: 300 });
    }

    /**
     * Provides the formatted portfolio or fallback message if failing.
     */
    async get(
      runtime: IAgentRuntime,
      _message: Memory,
      _state?: State
    ): Promise<string | null> {
      try {
        return await this.getFormattedPortfolio(runtime);
      } catch (error) {
        console.error("Error in wallet provider:", error);
        return null;
      }
    }

    /**
     * Connects and returns the SigningStargateClient instance
     */
    public async connect(runtime: IAgentRuntime): Promise<SigningStargateClient> {
      if (this.stargateClient) return this.stargateClient;

      if (!this.mnemonic) {
        throw new Error("Cosmos wallet mnemonic not provided");
      }

      // We already have our chain registry object as this.chainInfo
      // We'll pick the first RPC endpoint from the list:
      const rpcUrl = this.chainInfo.apis.rpc[0]?.address;
      if (!rpcUrl) {
        throw new Error("No RPC endpoint found in chainInfo.apis.rpc");
      }

      // Prepare signer
      const signer = await getOfflineSigner({
        mnemonic: this.mnemonic,
        chain: this.chainInfo // pass the entire registry object
      });

      const stargateClient = await SigningStargateClient.connectWithSigner(
        rpcUrl,
        signer
      );

      // Derive first address from the signer
      const [firstAccount] = await signer.getAccounts();
      this.signerAddress = firstAccount.address;
      this.stargateClient = stargateClient;

      return stargateClient;
    }

    /**
     * Retrieves account balance & constructs a single-token portfolio
     * (assuming a single base token for demonstration).
     */
    async fetchPortfolioValue(runtime: IAgentRuntime): Promise<WalletPortfolio> {
      const cacheKey = `portfolio-${this.chainInfo.chain_name}`;
      const cachedValue = this.cache.get<WalletPortfolio>(cacheKey);

      if (cachedValue) {
        console.log("Cache hit for fetchPortfolioValue");
        return cachedValue;
      }

      // Ensure connected
      const client = await this.connect(runtime);

      if (!this.signerAddress) {
        throw new Error("Signer address not available. Connect first.");
      }

      // If we added .denom/.decimals to chainInfo:
      const baseDenom = this.chainInfo.denom || "uosmo";
      const decimals = this.chainInfo.decimals ?? 6;

      // Fetch balances
      const balances = await client.getAllBalances(this.signerAddress);
      const baseTokenBalance = balances.find(
        (b) => b.denom === baseDenom
      );

      // default to "0" if no balance found
      const rawBalance = baseTokenBalance?.amount ?? "0";

      // fetch token price from e.g. Coingecko
      const tokenPriceUsd = await this.fetchTokenPrice(runtime) || 0;

      // Convert from minimal denom to "1" denom
      const convertedBalance = new BigNumber(rawBalance).shiftedBy(-decimals);
      const valueUsd = convertedBalance.multipliedBy(tokenPriceUsd).toFixed();

      const portfolio: WalletPortfolio = {
        totalUsd: valueUsd,
        tokens: [
          {
            name: this.chainInfo.pretty_name || "Osmosis",
            symbol: "OSMO", // or set dynamically if you have that info
            decimals,
            balance: rawBalance,
            uiAmount: convertedBalance.toString(),
            priceUsd: tokenPriceUsd.toString(),
            valueUsd: valueUsd,
          },
        ],
      };

      this.cache.set(cacheKey, portfolio);
      return portfolio;
    }

    /**
     * Example token price fetcher for demonstration.
     * In production, you might fetch from Coingecko or similar.
     */
    private async fetchTokenPrice(runtime: IAgentRuntime): Promise<number> {
      const cacheKey = `price-${this.chainInfo.chain_name}`;
      const cachedPrice = this.cache.get<number>(cacheKey);

      if (cachedPrice) {
        return cachedPrice;
      }

      try {
        // For demonstration, we assume OSMO price from Coingecko
        // If chain is not OSMO, adapt the ID or fetch from a different endpoint.
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=osmosis&vs_currencies=usd"
        );
        if (!response.ok) {
          throw new Error(`Error fetching token price. Status: ${response.status}`);
        }
        const data = await response.json();
        const price = data.osmosis?.usd ?? 0;
        this.cache.set(cacheKey, price);
        return price;
      } catch (error) {
        console.error("Error fetching token price:", error);
        return 0;
      }
    }

    /**
     * Format portfolio into a text string for display
     */
    formatPortfolio(
      runtime: IAgentRuntime,
      portfolio: WalletPortfolio
    ): string {
      let output = `${runtime.character.system}\n`;
      output += `Chain: ${this.chainInfo.chain_name}\n`;

      if (this.signerAddress) {
        output += `Account Address: ${this.signerAddress}\n\n`;
      }

      const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
      output += `Total Value: $${totalUsdFormatted}\n\n`;
      output += "Token Balances:\n";

      for (const token of portfolio.tokens) {
        const tokenValUsd = new BigNumber(token.valueUsd).toFixed(2);
        output += `${token.name} (${token.symbol}): ${token.uiAmount} ($${tokenValUsd})\n`;
      }

      output += "\nMarket Prices:\n";
      for (const token of portfolio.tokens) {
        const tokenPriceUsd = new BigNumber(token.priceUsd).toFixed(2);
        output += `${token.symbol}: $${tokenPriceUsd}\n`;
      }

      return output;
    }

    /**
     * Convenience method to fetch + format
     */
    async getFormattedPortfolio(runtime: IAgentRuntime): Promise<string> {
      try {
        const portfolio = await this.fetchPortfolioValue(runtime);
        return this.formatPortfolio(runtime, portfolio);
      } catch (error) {
        console.error("Error generating portfolio report:", error);
        return "Unable to fetch wallet information. Please try again later.";
      }
    }
  }

  /**
   * Single instance of wallet provider
   */
  const walletProvider: Provider = {
    get: async (
      runtime: IAgentRuntime,
      _message: Memory,
      _state?: State
    ): Promise<string | null> => {
      try {
        // In a real scenario, you'd load these from environment or runtime settings
        const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
        const chainName = runtime.getSetting("COSMOS_CHAIN_NAME") || "osmosis";

        if (!mnemonic) {
          throw new Error("COSMOS_MNEMONIC not configured");
        }

        // 1) Look up chain data from chain-registry
        const chain = chains.find((c) => c.chain_name === chainName);
        if (!chain) {
          throw new Error(`Chain '${chainName}' not found in chain-registry`);
        }

        console.log("chaininfo", chain)

        // Convert chain-registry object to our interface
        // (Optional: if you're certain the chain matches the interface, you can cast directly.)
        const chainInfo: CosmosChainInfo = {
          ...chain,
          // We'll grab the first RPC as the "main" RPC:
          // chain.apis might be undefined for certain chains, so check
          apis: chain.apis || { rpc: [], rest: [], grpc: [] },

          // For demonstration, pick the first fee_token if available
          denom: chain.fees?.fee_tokens?.[0]?.denom || "uosmo",
          decimals: 6, // Cosmos is typically 6
        };

        // 2) Create the wallet provider
        const provider = new WalletProvider(mnemonic, chainInfo);

        // 3) Return the formatted portfolio
        return await provider.getFormattedPortfolio(runtime);
      } catch (error) {
        console.error("Error in wallet provider:", error);
        return null;
      }
    },
  };

  export { walletProvider };
