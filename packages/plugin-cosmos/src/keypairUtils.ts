// import { DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
// import { Point } from "@noble/secp256k1";
// import { IAgentRuntime } from "@elizaos/core";
// import { DeriveKeyProvider, TEEMode } from "@elizaos/plugin-cosmos-tee";
// import { fromBase64, fromHex } from "@cosmjs/encoding";
// // import { Pubkey } from "@cosmjs/amino";

// export interface WalletResult {
//     wallet?: DirectSecp256k1Wallet;
//     publicKey?: any;
// }

// /**
//  * Gets either a wallet or public key based on TEE mode and runtime settings
//  * @param runtime The agent runtime
//  * @param requirePrivateKey Whether to return a full wallet (true) or just public key (false)
//  * @returns WalletResult containing either wallet or public key
//  */
// export async function getCosmosWalletKey(
//     runtime: IAgentRuntime,
//     requirePrivateKey: boolean = true
// ): Promise<WalletResult> {
//     const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;

//     if (teeMode !== TEEMode.OFF) {
//         const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
//         if (!walletSecretSalt) {
//             throw new Error(
//                 "WALLET_SECRET_SALT required when TEE_MODE is enabled"
//             );
//         }

//         const deriveKeyProvider = new DeriveKeyProvider(teeMode);
//         const deriveKeyResult =
//             await deriveKeyProvider.deriveSecp256k1KeypairForCosmos(
//                 "/",
//                 walletSecretSalt,
//                 runtime.agentId
//             );

//         const privateKey = fromHex(deriveKeyResult.keypair.privateKey); // Assuming it's in hex
//         const publicKey = fromHex(deriveKeyResult.keypair.publicKey); // Assuming it's in hex

//         return requirePrivateKey
//             ? {
//                   wallet: await DirectSecp256k1Wallet.fromKey(privateKey),
//               }
//             : {
//                   publicKey: {
//                       type: "tendermint/PubKeySecp256k1",
//                       value: Buffer.from(publicKey).toString("base64"),
//                   },
//               };
//     }

//     // TEE mode is OFF
//     const privateKeyString =
//         runtime.getSetting("COSMOS_PRIVATE_KEY") ??
//         runtime.getSetting("WALLET_PRIVATE_KEY");

//     if (!privateKeyString) {
//         throw new Error("Private key not found in settings");
//     }

//     if (requirePrivateKey) {
//         try {
//             // Try decoding as base64
//             const privateKey = fromBase64(privateKeyString);
//             return {
//                 wallet: await DirectSecp256k1Wallet.fromKey(privateKey),
//             };
//         } catch (e) {
//             console.log("Error decoding base64 private key:", e);
//             try {
//                 // Then try decoding as hex
//                 console.log("Try decoding hex instead");
//                 const privateKey = fromHex(privateKeyString);
//                 return {
//                     wallet: await DirectSecp256k1Wallet.fromKey(privateKey),
//                 };
//             } catch (e2) {
//                 console.error("Error decoding private key:", e2);
//                 throw new Error("Invalid private key format");
//             }
//         }
//     } else {
//         const publicKeyString =
//             runtime.getSetting("COSMOS_PUBLIC_KEY") ??
//             runtime.getSetting("WALLET_PUBLIC_KEY");

//         if (!publicKeyString) {
//             throw new Error("Public key not found in settings");
//         }

//         try {
//             const publicKeyBytes = fromBase64(publicKeyString);

//             // Validate public key using noble-secp256k1's Point class
//             Point.fromHex(publicKeyBytes);

//             return {
//                 publicKey: {
//                     type: "tendermint/PubKeySecp256k1",
//                     value: publicKeyString,
//                 },
//             };
//         } catch (e) {
//             console.error("Error decoding or validating public key:", e);
//             throw new Error("Invalid public key format");
//         }
//     }
// }

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
function generateCosmosAddress(
    publicKey: Uint8Array,
    prefix: string = "cosmos"
): string {
    // Take SHA256 hash of the public key
    const sha256 = crypto.createHash("sha256").update(publicKey).digest();

    // Take RIPEMD160 of the SHA256 hash
    const ripemd160 = crypto.createHash("ripemd160").update(sha256).digest();

    // Encode the result in Bech32
    return bech32.encode(prefix, bech32.toWords(ripemd160));
}

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
        console.log("here>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
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

    // TEE mode is OFF
    if (requirePrivateKey) {
        const privateKeyString =
            runtime.getSetting("COSMOS_PRIVATE_KEY") ??
            runtime.getSetting("WALLET_PRIVATE_KEY");

        if (!privateKeyString) {
            throw new Error("Private key not found in settings");
        }

        try {
            const privateKey = Uint8Array.from(
                Buffer.from(privateKeyString, "base64")
            );
            const publicKey = secp256k1.publicKeyCreate(privateKey, true);
            const address = generateCosmosAddress(publicKey);
            return { privateKey, publicKey, address };
        } catch (e) {
            console.error("Error creating wallet from private key: ", e);
            throw new Error("Invalid private key format");
        }
    } else {
        const publicKeyString =
            runtime.getSetting("COSMOS_PUBLIC_KEY") ??
            runtime.getSetting("WALLET_PUBLIC_KEY");

        if (!publicKeyString) {
            throw new Error("Public key not found in settings");
        }

        try {
            const publicKey = Uint8Array.from(
                Buffer.from(publicKeyString, "base64")
            );
            const address = generateCosmosAddress(publicKey);
            return { publicKey, address };
        } catch (e) {
            console.error("Error decoding public key: ", e);
            throw new Error("Invalid public key format");
        }
    }
}
