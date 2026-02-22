import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const chatroomStateProvider: Provider = {
  name: "clawbal-chatroom-state",
  description: "Current chatroom context for the agent",
  async get(runtime: IAgentRuntime) {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    if (!svc) return { text: "" };
    const room = svc.getCurrentChatroom();
    const rooms = Array.from(svc.getAllChatrooms().keys());
    return { text: `Active chatroom: ${room}. Available: ${rooms.join(", ")}` };
  },
};
