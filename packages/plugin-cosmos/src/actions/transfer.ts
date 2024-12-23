import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
    composeContext,
    generateObject,
  } from "@ai16z/eliza";
  import { chains } from 'chain-registry';
  import {
    getOfflineSignerProto as getOfflineSigner
  } from "cosmjs-utils";
  import { SigningStargateClient } from "@cosmjs/stargate";
  import { coins, StdFee } from "@cosmjs/amino";

  export interface TransferContent extends Content {
    recipient: string;
    amount: string | number;
    tokenAddress?: string; // optional if we want to handle cw20 or other tokens
  }

  function isTransferContent(
    runtime: IAgentRuntime,
    content: any
  ): content is TransferContent {
    return (
      typeof content.recipient === "string" &&
      (typeof content.amount === "string" || typeof content.amount === "number")
    );
  }

  const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

  Example response:
  \`\`\`json
  {
    "recipient": "osmo1abcd1234...",
    "amount": "1.5",
    "tokenAddress": null
  }
  \`\`\`

  {{recentMessages}}

  Given the recent messages and wallet information below:

  {{walletInfo}}

  Extract the following information about the requested token transfer:
  - Recipient address
  - Amount to transfer
  - Token contract address (null for native transfers)

  Respond with a JSON markdown block containing only the extracted values.
  `;

  async function transferTokens(
    runtime: IAgentRuntime,
    recipient: string,
    amount: string
  ): Promise<string> {
    // In a real scenario, fetch from environment or runtime settings
    const chainName = runtime.getSetting("COSMOS_CHAIN_NAME") || "osmosis";
    const rpc = runtime.getSetting("COSMOS_RPC_URL") || "https://rpc.osmosis.zone";
    const denom = runtime.getSetting("COSMOS_DENOM") || "uosmo";
    const decimals = Number(runtime.getSetting("COSMOS_DECIMALS") || 6);

    const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
    if (!mnemonic) {
      throw new Error("COSMOS_MNEMONIC not configured");
    }

    const chain = chains.find(({ chain_name }) => chain_name === chainName);

    // get signer
    const signer = await getOfflineSigner({
      mnemonic,
      chain,
    });

    // connect
    const stargateClient = await SigningStargateClient.connectWithSigner(rpc, signer);

    const [fromAccount] = await signer.getAccounts();
    const fromAddress = fromAccount.address;

    // Convert input amount (like 1.5) to base denom
    // E.g., 1.5 OSMO => 1500000 uosmo (if 6 decimals)
    const shift = Math.pow(10, decimals);
    const sendAmount = String(Math.floor(Number(amount) * shift));

    // Create send message
    // If needed, you can also specify a custom fee, otherwise it uses auto.
    // For demonstration:
    const fee: StdFee = {
      amount: coins("2000", denom), // minimal fee
      gas: "200000",
    };

    const result = await stargateClient.sendTokens(
      fromAddress,
      recipient,
      coins(sendAmount, denom),
      fee
    );

    return result.transactionHash;
  }

  export const executeTransfer: Action = {
    name: "SEND_COSMOS",
    similes: ["TRANSFER_COSMOS", "SEND_TOKENS", "TRANSFER_TOKENS", "PAY_COSMOS"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
      // Add your validation logic
      return true;
    },
    description: "Transfer native Cosmos tokens to another address",
    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      state: State,
      _options: { [key: string]: unknown },
      callback?: HandlerCallback
    ): Promise<boolean> => {
      // Initialize or update state
      if (!state) {
        state = (await runtime.composeState(message)) as State;
      } else {
        state = await runtime.updateRecentMessageState(state);
      }

      // Compose context
      const transferContext = composeContext({
        state,
        template: transferTemplate,
      });

      // Generate content
      const content = await generateObject({
        runtime,
        context: transferContext,
        modelClass: ModelClass.SMALL,
      });

      // Validate
      if (!isTransferContent(runtime, content)) {
        console.error("Invalid content for SEND_COSMOS action.");
        if (callback) {
          callback({
            text: "Unable to process transfer request. Invalid content provided.",
            content: { error: "Invalid transfer content" },
          });
        }
        return false;
      }

      try {
        const txHash = await transferTokens(
          runtime,
          content.recipient,
          content.amount.toString()
        );

        if (callback) {
          callback({
            text: `Successfully transferred ${content.amount} tokens to ${content.recipient}\nTransaction: ${txHash}`,
            content: {
              success: true,
              signature: txHash,
              amount: content.amount,
              recipient: content.recipient,
            },
          });
        }

        return true;
      } catch (error) {
        console.error("Error during Cosmos transfer:", error);
        if (callback) {
          callback({
            text: `Error transferring tokens: ${error}`,
            content: { error: error },
          });
        }
        return false;
      }
    },

    examples: [
      [
        {
          user: "{{user1}}",
          content: {
            text: "Send 1.5 tokens to osmo1abcd1234...",
          },
        },
        {
          user: "{{user2}}",
          content: {
            text: "I'll send 1.5 OSMO now...",
            action: "SEND_COSMOS",
          },
        },
        {
          user: "{{user2}}",
          content: {
            text: "Successfully sent 1.5 OSMO to osmo1abcd1234...\nTransaction: ABC123XYZ",
          },
        },
      ],
    ] as ActionExample[][],
  } as Action;
