import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { DirectSecp256k1Wallet, Registry } from "@cosmjs/proto-signing";
import { StargateClient } from "@cosmjs/stargate";
import BigNumber from "bignumber.js";
import NodeCache from "node-cache";
import { DeriveKeyProvider } from "./deriveKeyProvider";
import { RemoteAttestationQuote } from "../types/tee";

// Provider configuration
const PROVIDER_CONFIG = {
    COSMOS_API: "https://api.cosmos.network",
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    TOKEN_DENOM: "uatom", // Adjust for the desired Cosmos token
    DECIMALS: 6,
};

export interface Item {
    name: string;
    denom: string;
    decimals: number;
    balance: string;
    uiAmount: string;
    priceUsd: string;
    valueUsd: string;
}

interface WalletPortfolio {
    totalUsd: string;
    items: Array<Item>;
}

interface _PriceData {
    price: number;
    denom: string;
}

export class WalletProvider {
    private cache: NodeCache;

    constructor(
        private rpcEndpoint: string,
        private walletAddress: string
    ) {
        this.cache = new NodeCache({ stdTTL: 300 }); // Cache TTL set to 5 minutes
    }

    private async fetchWithRetry(
        runtime,
        url: string,
        options: RequestInit = {}
    ): Promise<any> {
        let lastError: Error;

        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        Accept: "application/json",
                        ...options.headers,
                    },
                });

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

    async fetchPortfolioValue(runtime): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.walletAddress}`;
            const cachedValue = this.cache.get<WalletPortfolio>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPortfolioValue");
                return cachedValue;
            }
            console.log("Cache miss for fetchPortfolioValue");

            const client = await StargateClient.connect(this.rpcEndpoint);
            const balance = await client.getBalance(
                this.walletAddress,
                PROVIDER_CONFIG.TOKEN_DENOM
            );

            if (!balance) {
                throw new Error("No balance data available");
            }

            const amount = new BigNumber(balance.amount).dividedBy(
                Math.pow(10, PROVIDER_CONFIG.DECIMALS)
            );

            const priceData = await this.fetchPrices(runtime);
            const priceUsd = new BigNumber(priceData.price);

            const valueUsd = amount.multipliedBy(priceUsd);

            const portfolio = {
                totalUsd: valueUsd.toFixed(2),
                items: [
                    {
                        name: "Cosmos",
                        denom: PROVIDER_CONFIG.TOKEN_DENOM,
                        decimals: PROVIDER_CONFIG.DECIMALS,
                        balance: balance.amount,
                        uiAmount: amount.toFixed(6),
                        priceUsd: priceUsd.toFixed(2),
                        valueUsd: valueUsd.toFixed(2),
                    },
                ],
            };

            this.cache.set(cacheKey, portfolio);
            return portfolio;
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            throw error;
        }
    }

    async fetchPrices(runtime): Promise<_PriceData> {
        try {
            const cacheKey = "price";
            const cachedValue = this.cache.get<_PriceData>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPrices");
                return cachedValue;
            }
            console.log("Cache miss for fetchPrices");

            const response = await this.fetchWithRetry(
                runtime,
                `${PROVIDER_CONFIG.COSMOS_API}/price?denom=${PROVIDER_CONFIG.TOKEN_DENOM}`
            );

            if (!response?.price) {
                throw new Error("No price data available");
            }

            const priceData = {
                price: response.price,
                denom: PROVIDER_CONFIG.TOKEN_DENOM,
            };

            this.cache.set(cacheKey, priceData);
            return priceData;
        } catch (error) {
            console.error("Error fetching prices:", error);
            throw error;
        }
    }

    formatPortfolio(runtime, portfolio: WalletPortfolio): string {
        let output = `${runtime.character.description}\n`;
        output += `Wallet Address: ${this.walletAddress}\n\n`;

        const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
        output += `Total Value: $${totalUsdFormatted}\n\n`;
        output += "Token Balances:\n";

        for (const item of portfolio.items) {
            output += `${item.name} (${item.denom}): ${item.uiAmount} ($${item.valueUsd})\n`;
        }

        return output;
    }

    async getFormattedPortfolio(runtime): Promise<string> {
        try {
            const portfolio = await this.fetchPortfolioValue(runtime);
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
    ): Promise<string> => {
        const agentId = runtime.agentId;
        const teeMode = runtime.getSetting("TEE_MODE");
        const deriveKeyProvider = new DeriveKeyProvider(teeMode);

        try {
            // Validate wallet configuration
            if (!runtime.getSetting("WALLET_SECRET_SALT")) {
                console.error(
                    "Wallet secret salt is not configured in settings"
                );
                return "";
            }

            let walletAddress: string;
            try {
                const derivedKeyPair: {
                    keypair: { privateKey: string; publicKey: string };
                    address: string;
                    attestation: RemoteAttestationQuote;
                } = await deriveKeyProvider.deriveSecp256k1KeypairForCosmos(
                    "/",
                    runtime.getSetting("WALLET_SECRET_SALT"),
                    agentId
                );

                const privateKeyBuffer = Buffer.from(
                    derivedKeyPair.keypair.privateKey,
                    "hex"
                );
                const wallet =
                    await DirectSecp256k1Wallet.fromKey(privateKeyBuffer);

                walletAddress = (await wallet.getAccounts())[0].address;
                console.log("Wallet Address: ", walletAddress);
            } catch (error) {
                console.error("Error creating wallet address:", error);
                return "";
            }

            console.log("walletAddress>>>>>>>>>", walletAddress);

            const rpcEndpoint = PROVIDER_CONFIG.COSMOS_API;
            const provider = new WalletProvider(rpcEndpoint, walletAddress);

            const portfolio = await provider.getFormattedPortfolio(runtime);
            return portfolio;
        } catch (error) {
            console.error("Error in wallet provider:", error.message);
            return `Failed to fetch wallet information: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
    },
};

// Module exports
export { walletProvider };
