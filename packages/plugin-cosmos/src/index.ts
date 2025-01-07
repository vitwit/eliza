<<<<<<< HEAD
import { Plugin } from "@elizaos/core";
import { walletProvider } from "./providers/wallet";
import executeTransfer from "./actions/transfer";

export const cosmosPlugin: Plugin = {
    name: "COSMOS",
    description: "Cosmos (e.g. Osmosis) Plugin for Eliza",
    providers: [walletProvider],
    actions: [executeTransfer],
    evaluators: [],
=======
import { cosmosWalletProvider } from "./providers/wallet.ts";
import type { Plugin } from "@elizaos/core";
import { balanceAction } from "./actions/walletProviderTestAction.ts";

export const cosmosPlugin: Plugin = {
    name: "cosmos",
    description: "Cosmos blockchain integration plugin",
    providers: [cosmosWalletProvider],
    evaluators: [],
    services: [],
    actions: [balanceAction],
>>>>>>> 49d76c39f6bebe8ae00b936817fca474dfc3e2d4
};

export default cosmosPlugin;
