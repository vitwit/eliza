import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";

import crypto from "crypto";
import { DeriveKeyResponse, TappdClient } from "@phala/dstack-sdk";

import { RemoteAttestationProvider } from "./remoteAttestationProvider";
import { TEEMode, RemoteAttestationQuote } from "../types/tee";
import secp256k1 from "secp256k1";
import { bech32 } from "bech32";
import { Secp256k1 } from "@cosmjs/crypto";

interface DeriveKeyAttestationData {
    agentId: string;
    publicKey: string;
}

async function convertUncompressedToCompressed(
    uncompressedPubKey: Uint8Array
): Promise<Uint8Array> {
    return await Secp256k1.compressPubkey(uncompressedPubKey);
}
class DeriveKeyProvider {
    private client: TappdClient;
    private raProvider: RemoteAttestationProvider;

    constructor(teeMode?: string) {
        let endpoint: string | undefined;

        switch (teeMode) {
            case TEEMode.LOCAL:
                endpoint = "http://localhost:8090";
                console.log(
                    "TEE: Connecting to local simulator at localhost:8090"
                );
                break;
            case TEEMode.DOCKER:
                endpoint = "http://host.docker.internal:8090";
                console.log(
                    "TEE: Connecting to simulator via Docker at host.docker.internal:8090"
                );
                break;
            case TEEMode.PRODUCTION:
                endpoint = undefined;
                console.log(
                    "TEE: Running in production mode without simulator"
                );
                break;
            default:
                throw new Error(
                    `Invalid TEE_MODE: ${teeMode}. Must be one of: LOCAL, DOCKER, PRODUCTION`
                );
        }

        this.client = endpoint ? new TappdClient(endpoint) : new TappdClient();
        this.raProvider = new RemoteAttestationProvider(teeMode);
    }

    private async generateDeriveKeyAttestation(
        agentId: string,
        publicKey: string
    ): Promise<RemoteAttestationQuote> {
        const deriveKeyData: DeriveKeyAttestationData = {
            agentId,
            publicKey,
        };
        const reportdata = JSON.stringify(deriveKeyData);
        console.log("Generating Remote Attestation Quote for Derive Key...");
        const quote = await this.raProvider.generateAttestation(reportdata);
        console.log("Remote Attestation Quote generated successfully!");
        return quote;
    }

    async rawDeriveKey(
        path: string,
        subject: string
    ): Promise<DeriveKeyResponse> {
        try {
            if (!path || !subject) {
                console.error(
                    "Path and Subject are required for key derivation"
                );
            }

            console.log("Deriving Raw Key in TEE...");
            const derivedKey = await this.client.deriveKey(path, subject);

            console.log("Raw Key Derived Successfully!");
            return derivedKey;
        } catch (error) {
            console.error("Error deriving raw key:", error);
            throw error;
        }
    }
    async deriveSecp256k1KeypairForCosmos(
        path: string,
        subject: string,
        agentId: string
    ): Promise<{
        keypair: { privateKey: string; publicKey: string };
        address: string; // Cosmos address
        attestation: RemoteAttestationQuote;
    }> {
        try {
            if (!path || !subject) {
                throw new Error(
                    "Path and Subject are required for key derivation"
                );
            }

            console.log("Deriving Secp256k1 Key in TEE...");
            const derivedKey = await this.client.deriveKey(path, subject);
            const uint8ArrayDerivedKey = derivedKey.asUint8Array();

            const privateKey = uint8ArrayDerivedKey.slice(0, 32);
            const publicKey = secp256k1.publicKeyCreate(privateKey, false);

            const compressedPublicKey =
                await convertUncompressedToCompressed(publicKey);

            // Step 1: Apply SHA256 hash to the public key
            const sha256 = crypto
                .createHash("sha256")
                .update(compressedPublicKey)
                .digest();

            // Step 2: Apply RIPEMD160 to the SHA256 hash
            const ripemd160 = crypto
                .createHash("ripemd160")
                .update(sha256)
                .digest();

            // Step 3: Encode the result in Bech32
            const cosmosAddress = bech32.encode(
                "osmo", // change this to your specified prefix
                bech32.toWords(ripemd160) // Use the 20-byte hash from RIPEMD160
            );

            const attestation = await this.generateDeriveKeyAttestation(
                agentId,
                Buffer.from(publicKey).toString("hex")
            );
            console.log("Secp256k1 Key Derived Successfully!");

            return {
                keypair: {
                    privateKey: Buffer.from(privateKey).toString("hex"),
                    publicKey: Buffer.from(publicKey).toString("hex"),
                },
                address: cosmosAddress,
                attestation,
            };
        } catch (error) {
            console.error("Error deriving Secp256k1 key for Cosmos:", error);
            throw error;
        }
    }
}

const deriveKeyProvider: Provider = {
    get: async (runtime: IAgentRuntime, _message?: Memory, _state?: State) => {
        const teeMode = runtime.getSetting("TEE_MODE");
        const provider = new DeriveKeyProvider(teeMode);
        const agentId = runtime.agentId;
        try {
            if (!runtime.getSetting("WALLET_SECRET_SALT")) {
                console.error(
                    "Wallet secret salt is not configured in settings"
                );
                return "";
            }

            try {
                const secretSalt =
                    runtime.getSetting("WALLET_SECRET_SALT") || "secret_salt";
                const cosmosKeypair =
                    await provider.deriveSecp256k1KeypairForCosmos(
                        "/",
                        secretSalt,
                        agentId
                    );
                return JSON.stringify({
                    cosmos: cosmosKeypair.address,
                });
            } catch (error) {
                console.error("Error creating PublicKey:", error);
                return "";
            }
        } catch (error) {
            console.error("Error in derive key provider:", error.message);
            return `Failed to fetch derive key information: ${
                error instanceof Error ? error.message : "Unknown error"
            }`;
        }
    },
};

export { deriveKeyProvider, DeriveKeyProvider };
