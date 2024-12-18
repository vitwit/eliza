import { Plugin } from "@ai16z/eliza";
import transferToken from "./actions/transfer.ts"; // Update this action if you implement Cosmos-specific token transfers
import { WalletProvider, walletProvider } from "./providers/wallet.ts";

export { WalletProvider, transferToken as TransferCosmosToken };

export const cosmosPlugin: Plugin = {
    name: "cosmos",
    description: "Cosmos Plugin for Eliza",
    actions: [transferToken], // Include Cosmos-specific actions, such as token transfers
    evaluators: [], // Add evaluators here if needed
    providers: [walletProvider], // Use the Cosmos Wallet Provider
};

export default cosmosPlugin;
