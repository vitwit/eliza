import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WalletProvider } from "../providers/wallet.ts";

import { defaultCharacter } from "@ai16z/eliza";
import BigNumber from "bignumber.js";
import { DirectSecp256k1Wallet, QueryClient, setupBankExtension } from "@cosmjs/stargate";
import { Secp256k1 } from "@cosmjs/crypto";
import { fromHex, toHex } from "@cosmjs/encoding";

// Mock NodeCache
vi.mock("node-cache", () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            set: vi.fn(),
            get: vi.fn().mockReturnValue(null),
        })),
    };
});

// Mock path module
vi.mock("path", async () => {
    const actual = await vi.importActual("path");
    return {
        ...actual,
        join: vi.fn().mockImplementation((...args) => args.join("/")),
    };
});

// Mock the ICacheManager
const mockCacheManager = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
};

// Mock QueryClient and bank balance
vi.mock("@cosmjs/stargate", () => {
    return {
        ...vi.importActual("@cosmjs/stargate"),
        QueryClient: {
            withExtensions: vi.fn().mockResolvedValue({
                bank: {
                    balance: vi.fn().mockResolvedValue({ amount: "1000000", denom: "uatom" }),
                },
            }),
        },
    };
});

// Mock fetch for price data
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
        cosmos: { usd: "10.50" },
    }),
});

describe("WalletProvider", () => {
    let walletProvider;
    let mockedRuntime;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockCacheManager.get.mockResolvedValue(null);

        const rpcUrl = "http://localhost:26657";
        const mnemonic = "test test test test test test test test test test test ball";
        const wallet = await DirectSecp256k1Wallet.fromMnemonic(mnemonic);
        const [{ address }] = await wallet.getAccounts();

        // Create new instance of WalletProvider with mocked dependencies
        walletProvider = new WalletProvider(rpcUrl, address, mockCacheManager);

        mockedRuntime = {
            character: defaultCharacter,
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe("Wallet Integration", () => {
        it("should check wallet address", async () => {
            const result = await walletProvider.getFormattedPortfolio(mockedRuntime);

            const prices = await walletProvider.fetchPrices();
            const balances = await walletProvider.fetchPortfolioValue();

            const atomAmount = new BigNumber(balances.totalAtom).toFixed(4);
            const totalUsd = new BigNumber(balances.totalUsd).toFixed(2);

            expect(result).toEqual(
                `Eliza\nWallet Address: ${walletProvider.address}\n` +
                    `Total Value: $${totalUsd} (${atomAmount} ATOM)\n`
            );
        });

        it("should fetch Cosmos token prices", async () => {
            const prices = await walletProvider.fetchPrices();
            expect(prices).toEqual({ atom: { usd: "10.50" } });
        });

        it("should fetch and format wallet portfolio", async () => {
            const portfolio = await walletProvider.fetchPortfolioValue();
            expect(portfolio).toEqual({
                totalUsd: "10.50",
                totalAtom: "1.0000", // 1 uatom = 1e-6 ATOM
            });

            const formattedPortfolio = walletProvider.formatPortfolio(mockedRuntime, portfolio);
            expect(formattedPortfolio).toEqual(
                `Eliza\nWallet Address: ${walletProvider.address}\n` +
                    `Total Value: $10.50 (1.0000 ATOM)\n`
            );
        });

        it("should cache portfolio data", async () => {
            const spySetCache = vi.spyOn(mockCacheManager, "set");
            await walletProvider.fetchPortfolioValue();
            expect(spySetCache).toHaveBeenCalled();
        });
    });
});
