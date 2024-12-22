import {
    IAgentRuntime,
    ICacheManager,
    Memory,
    Provider,
    State,
} from "@ai16z/eliza";
import { DirectSecp256k1HdWallet, coin } from "@cosmjs/proto-signing";
import BigNumber from "bignumber.js";
import NodeCache from "node-cache";
import * as path from "path";
import { osmosis } from 'osmojs';

const PROVIDER_CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
};

interface WalletPortfolio {
    totalUsd: string;
    totalAtom: string;
}

interface Prices {
    atom: { usd: string };
}

export class WalletProvider {
    private cache: NodeCache;
    private cacheKey: string = "cosmos/wallet";

    constructor(
        private rpcUrl: string,
        private address: string,
        private cacheManager: ICacheManager
    ) {
        this.cache = new NodeCache({ stdTTL: 300 }); // Cache TTL set to 5 minutes
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.cacheManager.get<T>(
            path.join(this.cacheKey, key)
        );
        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.cacheManager.set(path.join(this.cacheKey, key), data, {
            expires: Date.now() + 5 * 60 * 1000,
        });
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        const cachedData = this.cache.get<T>(key);
        if (cachedData) {
            return cachedData;
        }

        const fileCachedData = await this.readFromCache<T>(key);
        if (fileCachedData) {
            this.cache.set(key, fileCachedData);
            return fileCachedData;
        }

        return null;
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        this.cache.set(cacheKey, data);
        await this.writeToCache(cacheKey, data);
    }

    private async fetchPricesWithRetry() {
        let lastError: Error;

        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=cosmos&vs_currencies=usd`
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(
                        `HTTP error! status: ${response.status}, message: ${errorText}`
                    );
                }

                const data = await response.json();
                return data;
            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                lastError = error;
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        console.error(
            "All attempts failed. Throwing the last error:",
            lastError
        );
        throw lastError;
    }

    async fetchPortfolioValue(): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.address}`;
            const cachedValue =
                await this.getCachedData<WalletPortfolio>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPortfolioValue", cachedValue);
                return cachedValue;
            }
            console.log("Cache miss for fetchPortfolioValue");

            const prices = await this.fetchPrices().catch((error) => {
                console.error("Error fetching ATOM price:", error);
                throw error;
            });

            const { createRPCQueryClient } = osmosis.ClientFactory;
            const client = await createRPCQueryClient({ rpcEndpoint: this.rpcUrl });

            // now you can query the cosmos modules
            const balances = await client.cosmos.bank.v1beta1
                .allBalances({ address: this.address });

            const atomAmount = new BigNumber(balances[0].amount).dividedBy(1_000_000); // Convert from uatom to ATOM
            const totalUsd = atomAmount.times(prices.atom.usd);


            const portfolio = {
                totalUsd: totalUsd.toString(),
                totalAtom: atomAmount.toString(),
            };

            this.setCachedData(cacheKey, portfolio);
            console.log("Fetched portfolio:", portfolio);
            return portfolio;
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            throw error;
        }
    }

    async fetchPrices(): Promise<Prices> {
        try {
            const cacheKey = "prices";
            const cachedValue = await this.getCachedData<Prices>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPrices");
                return cachedValue;
            }
            console.log("Cache miss for fetchPrices");

            const atomPriceData = await this.fetchPricesWithRetry().catch(
                (error) => {
                    console.error("Error fetching ATOM price:", error);
                    throw error;
                }
            );

            const prices: Prices = {
                atom: { usd: atomPriceData.cosmos.usd },
            };

            this.setCachedData(cacheKey, prices);
            return prices;
        } catch (error) {
            console.error("Error fetching prices:", error);
            throw error;
        }
    }

    formatPortfolio(runtime, portfolio: WalletPortfolio): string {
        let output = `${runtime.character.name}\n`;
        output += `Wallet Address: ${this.address}\n`;

        const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
        const totalAtomFormatted = new BigNumber(portfolio.totalAtom).toFixed(4);

        output += `Total Value: $${totalUsdFormatted} (${totalAtomFormatted} ATOM)\n`;

        return output;
    }

    async getFormattedPortfolio(runtime): Promise<string> {
        try {
            const portfolio = await this.fetchPortfolioValue();
            return this.formatPortfolio(runtime, portfolio);
        } catch (error) {
            console.error("Error generating portfolio report:", error);
            return "Unable to fetch wallet information. Please try again later.";
        }
    }
}

const walletProvider: Provider = {
    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string | null> => {
        const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
            prefix: "cosmos",
        });
        const [{ address }] = await wallet.getAccounts();

        try {
            const rpcUrl = runtime.getSetting("COSMOS_RPC_URL");
            const provider = new WalletProvider(
                rpcUrl,
                address,
                runtime.cacheManager
            );
            return await provider.getFormattedPortfolio(runtime);
        } catch (error) {
            console.error("Error in wallet provider:", error);
            return null;
        }
    },
};

// Module exports
export { walletProvider };
