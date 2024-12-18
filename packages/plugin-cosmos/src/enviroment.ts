import { IAgentRuntime } from "@ai16z/eliza";
import { z } from "zod";

export const cosmosEnvSchema = z.object({
    COSMOS_MNEMONIC: z.string().min(1, "Cosmos mnemonic is required"),
    COSMOS_RPC_URL: z.string().url("A valid Cosmos RPC URL is required"),
});

export type CosmosConfig = z.infer<typeof cosmosEnvSchema>;

export async function validateCosmosConfig(
    runtime: IAgentRuntime
): Promise<CosmosConfig> {
    try {
        const config = {
            COSMOS_MNEMONIC:
                runtime.getSetting("COSMOS_MNEMONIC") ||
                process.env.COSMOS_MNEMONIC,
            COSMOS_RPC_URL:
                runtime.getSetting("COSMOS_RPC_URL") ||
                process.env.COSMOS_RPC_URL,
        };

        return cosmosEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Cosmos configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
