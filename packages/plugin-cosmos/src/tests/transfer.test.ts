import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { transferAction, AnyCosmosMsg, TransferCallback } from "../actions/transfer"; // import the default export from your updated transfer.ts
import { defaultCharacter, State, Memory, IAgentRuntime } from "@ai16z/eliza";

/**
 * 1) We mock only the LLM extraction step (generateObjectDeprecated),
 *    returning a "recipient" and "amount" for the transaction.
 */
vi.mock("@ai16z/eliza", async () => {
  const actual = await vi.importActual("@ai16z/eliza");
  return {
    ...actual,
    generateObjectDeprecated: vi.fn().mockImplementation(async () => {
      // Hardcode the content for transfer
      return {
        recipient: "osmo1dxapu02qxcgmr2xt8v3ca6mhwtuygmc46rfryx",
        amount: "1"
      };
    }),
  };
});

// Minimal memory
const mockedMemory = {
    get: (k) => (k === "memo" ? "My custom memo" : null),
    set: () => {},
  } as Memory;

const myCallback: TransferCallback = (res) => {
    if (res.success) {
      console.log("Tx succeeded with hash:", res.txHash);
    } else {
      console.warn("Tx failed with error:", res.error);
    }
  };

describe("Cosmos Transfer Integration Test", () => {
  let mockedRuntime: any;
  let testState: State;
  let callbackResult: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // 2) Minimal runtime that fetches environment variables
    //    for COSMOS_MNEMONIC, COSMOS_CHAIN_NAME, etc.
    mockedRuntime = {
      character: defaultCharacter,
      getSetting: (key: string) => {
        // e.g. read from process.env or .env
        return process.env[key];
      },
      composeState: vi.fn().mockResolvedValue({} as State),
      updateRecentMessageState: vi.fn().mockResolvedValue({} as State),
    };

    testState = {} as State;
    callbackResult = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("should transfer a small amount of tokens on a real chain", async () => {
    /**
     * 3) Construct a sample Memory object that says we want to transfer 0.001 tokens
     *    (the actual numeric values come from our mock above).
     */
    const message = {
      text: "Send 0.001 tokens to osmo1abcd..."
    };

    // 4) Provide a callback to capture success/error
    const callback = (info: any) => {
      callbackResult = info;
    };

    // Suppose you have a custom send message
const msg: AnyCosmosMsg = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: {
      fromAddress: "osmo1dxapu02qxcgmr2xt8v3ca6mhwtuygmc46rfryx",
      toAddress: "osmo1dxapu02qxcgmr2xt8v3ca6mhwtuygmc46rfryx",
      amount: [{ denom: "uosmo", amount: "1000" }],
    },
  };

  const result = await transferAction.handler(
    mockedRuntime,
    mockedMemory,
    {},       // state (if needed)
    msg,      // cosmos message
    myCallback // callback
  );

    // 6) Validate results
    if (result) {
      console.log("Transfer broadcasted successfully!", result);
      console.log("Callback Result:", callbackResult);
      expect(callbackResult.text).toMatch(/Successfully transferred/i);
      expect(callbackResult.content?.hash).toBeDefined(); // the real TX hash
    } else {
      console.log("Transfer failed. Callback Result:", callbackResult);
      expect(callbackResult.content?.error).toBeDefined();
    }
  });
});
