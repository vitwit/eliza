import secp256k1 from "secp256k1";
import bech32 from "bech32";
import crypto from "crypto";
import { DeriveKeyProvider, TEEMode } from "@elizaos/plugin-cosmos-tee";
import { IAgentRuntime } from "@elizaos/core";

export interface CosmosKeypairResult {
    privateKey?: Uint8Array;
    publicKey?: Uint8Array;
    address?: string;
}

/**
 * Generates a Cosmos address from a public key.
 * @param publicKey The raw public key as a Uint8Array.
 * @param prefix The Bech32 prefix (e.g., "cosmos").
 * @returns The Bech32-encoded address.
 */
// function generateCosmosAddress(
//     publicKey: Uint8Array,
//     prefix: string = "cosmos"
// ): string {
//     // Take SHA256 hash of the public key
//     const sha256 = crypto.createHash("sha256").update(publicKey).digest();

//     // Take RIPEMD160 of the SHA256 hash
//     const ripemd160 = crypto.createHash("ripemd160").update(sha256).digest();

//     // Encode the result in Bech32
//     return bech32.encode(prefix, bech32.toWords(ripemd160));
// }

/**
 * Gets either a keypair or public key based on TEE mode and runtime settings
 * @param runtime The agent runtime
 * @param requirePrivateKey Whether to return a full keypair (true) or just public key (false)
 * @returns CosmosKeypairResult containing keys or address
 */
export async function getCosmosWalletKey(
    runtime: IAgentRuntime,
    requirePrivateKey: boolean = true
): Promise<CosmosKeypairResult> {
    const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;

    if (teeMode !== TEEMode.OFF) {
        const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
        if (!walletSecretSalt) {
            throw new Error(
                "WALLET_SECRET_SALT required when TEE_MODE is enabled"
            );
        }

        const deriveKeyProvider = new DeriveKeyProvider(teeMode);
        const deriveKeyResult =
            await deriveKeyProvider.deriveSecp256k1KeypairForCosmos(
                "/",
                walletSecretSalt,
                runtime.agentId
            );

        const privateKey = Uint8Array.from(
            Buffer.from(deriveKeyResult.keypair.privateKey, "hex") // Change to "hex"
        );
        const publicKey = Uint8Array.from(
            Buffer.from(deriveKeyResult.keypair.publicKey, "hex")
        );

        console.log(
            "Derived Public Key:",
            Buffer.from(publicKey).toString("hex")
        );

        const address = deriveKeyResult.address;

        return requirePrivateKey
            ? { privateKey, publicKey, address }
            : { publicKey, address };
    }
    return {};
}
