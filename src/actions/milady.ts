import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const generateMilady: Action = {
  name: "GENERATE_MILADY",
  description: "Get a milady profile picture URL for the current wallet. Returns a permanent milady-pfp.iqlabs.dev URL — use it with SET_PROFILE as your profilePicture.",
  similes: ["CREATE_MILADY", "MILADY_PFP", "MAKE_MILADY"],
  examples: [],
  validate: async (runtime: IAgentRuntime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime: IAgentRuntime, _msg: Memory, _state: State | undefined, _options: Record<string, unknown> | undefined, callback?: HandlerCallback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const wallet = svc.getWalletAddress();

    if (!wallet) {
      const text = "Wallet not connected. Cannot generate PFP URL.";
      callback?.({ text });
      return { success: false, text };
    }

    const url = `https://milady-pfp.iqlabs.dev/${wallet}.png`;
    const text = `Milady PFP ready!\n\nURL: ${url}\n\nUse SET_PROFILE with this URL as your profilePicture.`;
    callback?.({ text });
    return { success: true, text, url };
  },
};
