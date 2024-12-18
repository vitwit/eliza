import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    composeContext,
    elizaLogger,
    generateObject,
    type Action,
} from "@ai16z/eliza";
import { z } from "zod";

import { SigningStargateClient } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

export interface TransferContent extends Content {
    recipient: string;
    amount: string | number;
}

function isTransferContent(content: Content): content is TransferContent {
    console.log("Content for transfer", content);
    return (
        typeof content.recipient === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "cosmos1jlqj24k48syd4mgczfsez93c2jp3l0h3l75d2t",
    "amount": "1"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Recipient wallet address
- Amount to transfer

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "SEND_TOKEN",
    similes: [
        "TRANSFER_TOKEN",
        "TRANSFER_TOKENS",
        "SEND_ATOM",
        "PAY",
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating Cosmos transfer from user:", message.userId);
        return true; // Add custom validation logic if required
    },
    description: "Transfer tokens from the agent's wallet to another address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SEND_TOKEN handler...");

        const walletInfo = await runtime.getSetting("COSMOS_MNEMONIC");
        state.walletInfo = walletInfo;

        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const transferSchema = z.object({
            recipient: z.string(),
            amount: z.union([z.string(), z.number()]),
        });

        const transferContext = composeContext({
            state,
            template: transferTemplate,
        });

        const content = await generateObject({
            runtime,
            context: transferContext,
            schema: transferSchema,
            modelClass: ModelClass.SMALL,
        });

        const transferContent = content.object as TransferContent;

        if (!isTransferContent(transferContent)) {
            console.error("Invalid content for TRANSFER_TOKEN action.");
            if (callback) {
                callback({
                    text: "Unable to process transfer request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
            const rpcUrl = runtime.getSetting("COSMOS_RPC_URL");

            const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic);
            const [account] = await wallet.getAccounts();
            const client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet);

            const adjustedAmount = (Number(transferContent.amount) * 1e6).toString(); // Convert ATOM to uatom
            console.log(`Transferring: ${transferContent.amount} tokens (${adjustedAmount} uatom)`);

            const result = await client.sendTokens(
                account.address,
                transferContent.recipient,
                [{ denom: "uatom", amount: adjustedAmount }],
                { amount: [{ denom: "uatom", amount: "5000" }], gas: "200000" } // Default fee
            );

            console.log("Transfer successful:", result.transactionHash);

            if (callback) {
                callback({
                    text: `Successfully transferred ${transferContent.amount} ATOM to ${transferContent.recipient}, Transaction: ${result.transactionHash}`,
                    content: {
                        success: true,
                        hash: result.transactionHash,
                        amount: transferContent.amount,
                        recipient: transferContent.recipient,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during token transfer:", error);
            if (callback) {
                callback({
                    text: `Error transferring tokens: ${error.message}`,
                    content: { error: error.message },
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
                    text: "Send 1 ATOM tokens to cosmos1jlqj24k48syd4mgczfsez93c2jp3l0h3l75d2t",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "I'll send 1 ATOM tokens now...",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Successfully sent 1 ATOM tokens to cosmos1jlqj24k48syd4mgczfsez93c2jp3l0h3l75d2t, Transaction: 0xABC1234567890DEF",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
