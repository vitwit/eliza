# Plugin TEE

A plugin for handling Trusted Execution Environment (TEE) operations.

## Providers

This plugin includes several providers for handling different TEE-related operations.

### DeriveKeyProvider

The `DeriveKeyProvider` allows for secure key derivation within a TEE environment. It supports deriving keys for cosmos chain.

#### Usage

```typescript
import { DeriveKeyProvider } from "@elizaos/plugincosmos-tee";

// Initialize the provider
const provider = new DeriveKeyProvider();

// Derive a raw key
try {
    const rawKey = await provider.rawDeriveKey(
        "/path/to/derive",
        "subject-identifier"
    );
    // rawKey is a DeriveKeyResponse that can be used for further processing
    // to get the uint8Array do the following
    const rawKeyArray = rawKey.asUint8Array();
} catch (error) {
    console.error("Raw key derivation failed:", error);
}

// Derive a cosmos keypair (secp256k1)
try {
    const solanaKeypair = await provider.deriveSecp256k1KeypairForCosmos(
        "/path/to/derive",
        "subject-identifier"
    );
    // cosmosKeypair can now be used for cosmos operations
} catch (error) {
    console.error("Solana key derivation failed:", error);
}
```

### RemoteAttestationProvider

The `RemoteAttestationProvider` allows for generating a remote attestation within a TEE environment.

#### Usage

```typescript
const provider = new RemoteAttestationProvider();

try {
    const attestation = await provider.generateAttestation("your-report-data");
    console.log("Attestation:", attestation);
} catch (error) {
    console.error("Failed to generate attestation:", error);
}
```

### Configuration

To get a TEE simulator for local testing, use the following commands:

```bash
docker pull phalanetwork/tappd-simulator:latest
# by default the simulator is available in localhost:8090
docker run --rm -p 8090:8090 phalanetwork/tappd-simulator:latest
```

When using the provider through the runtime environment, ensure the following settings are configured:

```env
DSTACK_SIMULATOR_ENDPOINT="your-endpoint-url" # Optional, for simulator purposes if testing on mac or windows
WALLET_SECRET_SALT=your-secret-salt // Required to single agent deployments
```
