import { IAgentRuntime, Memory, State } from "@ai16z/eliza";
import { connectWallet, CosmosChainInfo } from "../providers/wallet";
import { SigningStargateClient, StdFee } from "@cosmjs/stargate";

// Define a generic "AnyCosmosMsg" interface (protobuf Any type)
export interface AnyCosmosMsg {
    typeUrl: string;
    value: any; // typically a protobuf-encoded object
  }

  // Define a callback type for handling success/failure or returning the result
  export type TransferCallback = (result: { success: boolean; txHash?: string; error?: string }) => void;


export const transferAction = {
  name: "transferTokens",
  description: "Send tokens to another address",
  /**
   *  handler function:
   *   - runtime: IAgentRuntime  (Eliza standard)
   *   - memory: Memory          (Eliza standard)
   *   - state?: State           (Eliza standard)
   *   - msg: AnyCosmosMsg       (the custom cosmos message)
   *   - callback?: TransferCallback  (optional function to receive results)
   */
  handler: async (
    runtime: IAgentRuntime,
    _memory: Memory,
    _state?: State,
    msg: AnyCosmosMsg,
    callback?: TransferCallback
  ): Promise<string> => {
    try {
      // 1) Gather required info
      const mnemonic = runtime.getSetting("COSMOS_MNEMONIC");
      if (!mnemonic) {
        throw new Error("COSMOS_MNEMONIC not set in environment");
      }

      const chainName = runtime.getSetting("COSMOS_CHAIN_NAME");
      const customRpc = runtime.getSetting("COSMOS_RPC_URL");
      const coingeckoID = runtime.getSetting("COSMOS_COINGECKO_ID");
      const customDenom = runtime.getSetting("COSMOS_CHAIN_DENOM");
      const customDecimals = Number(runtime.getSetting("COSMOS_CHAIN_DECIMALS") || 6);
      const bech32Prefix = runtime.getSetting("COSMOS_BECH32_PREFIX") || "osmo";

      // 2) Build chainInfo
      const chainInfo: CosmosChainInfo = {
        chain_name: chainName,
        bech32_prefix: bech32Prefix,
        coingecko_id: coingeckoID,
        apis: { rpc: [{ address: customRpc }] },
        denom: customDenom,
        decimals: customDecimals,
        fees: {
          fee_tokens: [
            {
              denom: customDenom,
              average_gas_price: 0.025,
            },
          ],
        },
      };


      // 3) Connect using shared connectWallet from wallet.ts
      const { stargateClient, signerAddress } = await connectWallet(
        mnemonic,
        chainInfo
      );

      // read memo from memory or runtime
      const memo = runtime.getSetting("COSMOS_TX_MEMO") || "Sending via cosmos eliza plugin - Built by Vitwit";

      const fee: StdFee = {
        amount: [
        {
            denom: "uosmo",
            amount: '5000'
        }
        ],
        gas: '286364'
    };

      // Broadcast the provided cosmos message
      console.log("Broadcasting Cosmos message:", msg);
      const broadcastResult = await stargateClient.signAndBroadcast(
        signerAddress,
        [msg],
        fee,
        memo
      );

      console.log("Broadcast result:", broadcastResult);

      if (broadcastResult.code !== 0) {
        // code != 0 means failure
        throw new Error(`Broadcast failed with code ${broadcastResult.code}`);
      }

    // If we have a callback, call it with success = true
      if (callback) {
        callback({ success: true, txHash: broadcastResult.transactionHash });
      }

      return `Broadcasted cosmos message successfully. TxHash: ${broadcastResult.transactionHash}`;
    } catch (error: any) {
        console.error("Error in transferAction handler:", error);

        // If callback is provided, notify of error
        if (callback) {
          callback({ success: false, error: error.message });
        }

        return `Broadcast failed: ${error.message}`;
    }
  },
};
