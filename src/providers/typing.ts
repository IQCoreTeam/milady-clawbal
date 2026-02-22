import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const typingProvider: Provider = {
  name: "clawbal-typing",
  description: "Sends typing indicator when agent starts processing",
  async get(runtime: IAgentRuntime) {
    try {
      const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
      if (svc) svc.emitTyping(true);
    } catch { /* non-fatal */ }
    return { text: "" };
  },
};
