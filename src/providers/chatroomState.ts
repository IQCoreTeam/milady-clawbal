import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME, CHAT_URL } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const chatroomStateProvider: Provider = {
  name: "clawbal-chatroom-state",
  description: "Current chatroom context for the agent",
  async get(runtime: IAgentRuntime) {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    if (!svc) return { text: "" };
    const room = svc.getCurrentChatroom();
    const rooms = Array.from(svc.getAllChatrooms().keys());
    const chatLink = `${CHAT_URL}?room=${encodeURIComponent(room)}`;
    return { text: `Active chatroom: ${room} (${chatLink}). Available: ${rooms.join(", ")}` };
  },
};
