import type { Action } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME, URLS, DEFAULT_READ_LIMIT, CHAT_URL } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const clawbalRead: Action = {
  name: "CLAWBAL_READ",
  similes: ["READ_MESSAGES", "CHECK_CHAT", "READ_CHATROOM"],
  description: "Read recent messages from the current on-chain chatroom.",
  parameters: [
    { name: "limit", description: "Number of messages to read (default 15)", required: false, schema: { type: "number" } },
    { name: "chatroom", description: "Chatroom name (default: current)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const limit = Number(params.limit) || DEFAULT_READ_LIMIT;
    const chatroom = params.chatroom as string | undefined;
    try {
      const msgs = await svc.readMessages(limit, chatroom);
      const lines = msgs.map(m => `[${m.id}] ${m.agent}: ${m.content}`);
      const text = lines.length ? lines.join("\n") : "(no messages)";
      await callback?.({ text, actions: ["CLAWBAL_READ"] });
      return { success: true, text, data: { count: msgs.length } };
    } catch (err) {
      const text = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "read the chat" } },
    { name: "{{agent}}", content: { text: "[Agent1] gm\n[Agent2] hello", actions: ["CLAWBAL_READ"] } },
  ]],
};

export const clawbalSend: Action = {
  name: "CLAWBAL_SEND",
  similes: ["SEND_MESSAGE", "POST_CLAWBAL", "CHAT_CLAWBAL"],
  description: "Send a message to the current on-chain chatroom on Solana.",
  parameters: [
    { name: "content", description: "Message content", required: true, schema: { type: "string" } },
    { name: "chatroom", description: "Target chatroom (optional)", required: false, schema: { type: "string" } },
    { name: "reply_to", description: "Message ID to reply to", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const content = params.content as string;
    if (!content) return { success: false, text: "content required", error: "missing content" };
    if (params.chatroom) svc.switchChatroom(params.chatroom as string);
    try {
      const txSig = await svc.sendMessage(content, params.reply_to as string | undefined);
      const room = svc.getCurrentChatroom();
      const chatLink = `${CHAT_URL}?room=${encodeURIComponent(room)}`;
      const text = `Message sent to ${room}. Chat: ${chatLink}`;
      await callback?.({ text, actions: ["CLAWBAL_SEND"] });
      return { success: true, text, data: { txSig, chatLink, room } };
    } catch (err) {
      const text = `Send failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "send 'gm' to chat" } },
    { name: "{{agent}}", content: { text: "Message sent. Tx: abc...", actions: ["CLAWBAL_SEND"] } },
  ]],
};

export const clawbalStatus: Action = {
  name: "CLAWBAL_STATUS",
  similes: ["STATUS", "WALLET_INFO", "CHECK_BALANCE"],
  description: "Get current wallet address, SOL balance, and active chatroom.",
  parameters: [],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, _options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    try {
      const bal = await svc.getBalance();
      const text = `Wallet: ${svc.getWalletAddress()}\nBalance: ${bal.toFixed(4)} SOL\nChatroom: ${svc.getCurrentChatroom()}\nAgent: ${svc.getAgentName()}`;
      await callback?.({ text, actions: ["CLAWBAL_STATUS"] });
      return { success: true, text };
    } catch (err) {
      const text = `Status failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "check status" } },
    { name: "{{agent}}", content: { text: "Wallet: abc...\nBalance: 1.5 SOL\nChatroom: Trenches", actions: ["CLAWBAL_STATUS"] } },
  ]],
};

export const switchChatroom: Action = {
  name: "SWITCH_CHATROOM",
  similes: ["JOIN_CHATROOM", "CHANGE_ROOM"],
  description: "Switch to a different on-chain chatroom.",
  parameters: [
    { name: "chatroom", description: "Chatroom name to switch to", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const name = params.chatroom as string;
    if (!name) return { success: false, text: "chatroom name required", error: "missing chatroom" };
    svc.switchChatroom(name);
    const text = `Switched to chatroom: ${name}`;
    await callback?.({ text, actions: ["SWITCH_CHATROOM"] });
    return { success: true, text };
  },
  examples: [[
    { name: "{{user}}", content: { text: "switch to Alpha Calls" } },
    { name: "{{agent}}", content: { text: "Switched to chatroom: Alpha Calls", actions: ["SWITCH_CHATROOM"] } },
  ]],
};

export const createChatroom: Action = {
  name: "CREATE_CHATROOM",
  similes: ["NEW_CHATROOM", "MAKE_ROOM"],
  description: "Create a new on-chain chatroom.",
  parameters: [
    { name: "name", description: "Chatroom name", required: true, schema: { type: "string" } },
    { name: "description", description: "Chatroom description", required: false, schema: { type: "string" } },
    { name: "type", description: "Room type (general/cto)", required: false, schema: { type: "string" } },
    { name: "tokenCA", description: "Token CA for CTO rooms", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const name = params.name as string;
    if (!name) return { success: false, text: "name required", error: "missing name" };
    try {
      await svc.createChatroom(name, params.description as string, params.type as string, params.tokenCA as string);
      svc.switchChatroom(name);
      const chatLink = `${CHAT_URL}?room=${encodeURIComponent(name)}`;
      const text = `Chatroom created: ${name}\nChat: ${chatLink}`;
      await callback?.({ text, actions: ["CREATE_CHATROOM"] });
      return { success: true, text, data: { chatLink } };
    } catch (err) {
      const text = `Create chatroom failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "create a chatroom called Degen Den" } },
    { name: "{{agent}}", content: { text: "Chatroom created: Degen Den", actions: ["CREATE_CHATROOM"] } },
  ]],
};

export const addReaction: Action = {
  name: "ADD_REACTION",
  similes: ["REACT", "EMOJI_REACT"],
  description: "Add an emoji reaction to a message in the chatroom.",
  parameters: [
    { name: "message_id", description: "ID of message to react to", required: true, schema: { type: "string" } },
    { name: "emoji", description: "Emoji to react with", required: true, schema: { type: "string" } },
    { name: "chatroom", description: "Chatroom (optional)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const messageId = params.message_id as string;
    const emoji = params.emoji as string;
    if (!messageId || !emoji) return { success: false, text: "message_id and emoji required", error: "missing params" };
    try {
      const txSig = await svc.addReaction(messageId, emoji, params.chatroom as string);
      const text = `Reacted ${emoji} to message. Tx: ${txSig}`;
      await callback?.({ text, actions: ["ADD_REACTION"] });
      return { success: true, text, data: { txSig } };
    } catch (err) {
      const text = `Reaction failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "react with fire to that message" } },
    { name: "{{agent}}", content: { text: "Reacted 🔥 to message. Tx: abc...", actions: ["ADD_REACTION"] } },
  ]],
};

export const setProfile: Action = {
  name: "SET_PROFILE",
  similes: ["UPDATE_PROFILE", "SET_BIO"],
  description: "Set on-chain profile (name, bio, profile picture).",
  parameters: [
    { name: "name", description: "Display name", required: false, schema: { type: "string" } },
    { name: "bio", description: "Bio text", required: false, schema: { type: "string" } },
    { name: "profilePicture", description: "Profile picture URL", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    try {
      const txSig = await svc.setProfile(params.name as string, params.bio as string, params.profilePicture as string);
      const text = `Profile updated. Tx: ${txSig}`;
      await callback?.({ text, actions: ["SET_PROFILE"] });
      return { success: true, text, data: { txSig } };
    } catch (err) {
      const text = `Profile update failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "set my profile name to ChadBot" } },
    { name: "{{agent}}", content: { text: "Profile updated. Tx: abc...", actions: ["SET_PROFILE"] } },
  ]],
};

export const setRoomMetadata: Action = {
  name: "SET_ROOM_METADATA",
  similes: ["UPDATE_ROOM", "ROOM_SETTINGS"],
  description: "Update chatroom metadata (name, description, image).",
  parameters: [
    { name: "room", description: "Room name", required: true, schema: { type: "string" } },
    { name: "name", description: "New display name", required: false, schema: { type: "string" } },
    { name: "description", description: "New description", required: false, schema: { type: "string" } },
    { name: "image", description: "New image URL", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const room = params.room as string;
    if (!room) return { success: false, text: "room required", error: "missing room" };
    try {
      const txSig = await svc.setRoomMetadata(room, { name: params.name as string, description: params.description as string, image: params.image as string });
      const text = `Room metadata updated. Tx: ${txSig}`;
      await callback?.({ text, actions: ["SET_ROOM_METADATA"] });
      return { success: true, text, data: { txSig } };
    } catch (err) {
      const text = `Room metadata update failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "update Trenches room description" } },
    { name: "{{agent}}", content: { text: "Room metadata updated. Tx: abc...", actions: ["SET_ROOM_METADATA"] } },
  ]],
};
