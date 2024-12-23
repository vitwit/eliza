import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WalletProvider } from "../providers/wallet";
import { defaultCharacter } from "@ai16z/eliza";
import { chains } from 'chain-registry/testnet';

// Mock NodeCache so we don't actually cache or cause side effects
vi.mock("node-cache", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      set: vi.fn(),
      get: vi.fn().mockReturnValue(null),
    })),
  };
});

// Mock path if needed (like in your SUI example):
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...actual,
    join: vi.fn().mockImplementation((...args) => args.join("/")),
  };
});

// Mock the ICacheManager if you’re using a custom cache manager
const mockCacheManager = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
  delete: vi.fn(),
};

describe("Cosmos WalletProvider", () => {
  let walletProvider: WalletProvider;
  let mockedRuntime: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Example mnemonic. DO NOT use real keys in test code!
    const mnemonic ="unfold client turtle either pilot stock floor glow toward bullet car science";
    const chainName = "osmosistestnet";

    const chain = chains.find((c) => c.chain_name === chainName);
    if (!chain) {
      throw new Error(`Chain '${chainName}' not found in chain-registry`);
    }

    // If your wallet provider requires additional chain config, pass it here:
    walletProvider = new WalletProvider(
      mnemonic,
      chain,
      mockCacheManager
    );

    // Mock runtime/character
    mockedRuntime = {
      character: defaultCharacter,
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("Wallet Integration", () => {
    it("should return a formatted portfolio with wallet address", async () => {
      // Retrieve the portfolio text
      const result = await walletProvider.getFormattedPortfolio(mockedRuntime);

      // In a real test, you'd parse the string or validate its structure.
      // For demonstration, we just check that it includes the chain_name
      // and a "Account Address" label or something similar.
      expect(result).toContain("osmosis");
      expect(result).toContain("Account Address:");
    });

    it("should contain a total value in USD", async () => {
      const result = await walletProvider.getFormattedPortfolio(mockedRuntime);

      // For example, check if it says "Total Value: $"
      expect(result).toMatch(/Total Value: \$[\d,]+\.\d{2}/);
    });
  });
});
