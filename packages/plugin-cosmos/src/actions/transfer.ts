import { IAgentRuntime, Memory, State } from "@ai16z/eliza";
import { connectWallet } from "../providers/wallet";
import { StdFee } from "@cosmjs/stargate";

// Define a generic "AnyCosmosMsg" interface (protobuf Any type)
export interface AnyCosmosMsg {
  typeUrl: string;
  value: any; // typically a protobuf-encoded object
}

// Define a callback type for handling success/failure or returning the result
export type TransferCallback = (result: {
  success: boolean;
  txHash?: string;
  error?: string;
}) => void;

export const transferAction = {
  name: "transferTokens",
  description: "Send tokens to another address",
  /**
   * handler function:
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
      // 1) Connect using shared connectWallet from wallet.ts
      const { stargateClient, signerAddress } = await connectWallet(runtime);

      // 2) read memo from environment or defaults
      const memo =
        runtime.getSetting("COSMOS_TX_MEMO") ||
        "Sending via cosmos eliza plugin - Built by Vitwit";

      // 3) Build a fallback fee
      //    Or you might want to run stargateClient.simulate(...) to be more precise
      const fee: StdFee = {
        amount: [
          {
            denom: "uosmo",
            amount: "5000",
          },
        ],
        gas: "286364",
      };

      console.log("Broadcasting Cosmos message:", msg);

      // 4) sign & broadcast
      const broadcastResult = await stargateClient.signAndBroadcast(
        signerAddress,
        [msg],
        fee,
        memo
      );
      console.log("Broadcast result:", broadcastResult);

      if (broadcastResult.code !== 0) {
        // code != 0 => failure
        throw new Error(`Broadcast failed with code ${broadcastResult.code}`);
      }

      // If we have a callback, call it with success = true
      if (callback) {
        callback({ success: true, txHash: broadcastResult.transactionHash });
      }

      return `Broadcasted cosmos message successfully. TxHash: ${broadcastResult.transactionHash}`;
    } catch (error: any) {
      console.error("Error in transferAction handler:", error);

      // If callback is provided, notify error
      if (callback) {
        callback({ success: false, error: error.message });
      }

      return `Broadcast failed: ${error.message}`;
    }
  },
};
