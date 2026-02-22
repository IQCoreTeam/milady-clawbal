/**
 * Chat actions: read, send, status, switch, create chatroom, reaction, profile, room metadata.
 */
import type { Action } from "@elizaos/core";
import { nanoid } from "nanoid";
import { PublicKey } from "@solana/web3.js";
import { getContext, getAgentName, buildChatroom, sha256 } from "./sdk.js";
import {
  URLS, CHATROOM_PREFIX, DB_ROOT_NAME, DEFAULT_READ_LIMIT,
  CHATROOM_METADATA_SUFFIX,
} from "./config.js";
import type { ClawbalMessage, ClawbalChatroom } from "./types.js";
import { sendTyping } from "./noti-ws.js";

// ─── CLAWBAL_READ ───
export const clawbalRead: Action = {
  name: "CLAWBAL_READ",
  description: "Read recent messages from a Clawbal on-chain chatroom. Returns the latest messages with IDs, authors, content, and timestamps.",
  similes: ["READ_CHAT", "READ_MESSAGES", "GET_MESSAGES", "CHECK_CHAT"],
  parameters: [
    {
      name: "chatroom",
      description: "Chatroom name to read from (omit for current room)",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "limit",
      description: "Number of messages to fetch (default 15, max 50)",
      required: false,
      schema: { type: "number" },
    },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(read|check|see|show|get|what'?s|latest|recent)\b.*\b(chat|message|room|clawbal|trenches)\b/i.test(text)
      || /\bclawbal[_ ]?read\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const limit = Math.min(Number(params.limit) || DEFAULT_READ_LIMIT, 50);
      const roomName = (params.chatroom as string) || ctx.currentChatroom.name;
      const target = ctx.allChatrooms.get(roomName) || ctx.currentChatroom;

      // Try API first, then gateway, then SDK
      let messages: ClawbalMessage[] = [];
      try {
        const res = await fetch(`${URLS.base}/api/v1/messages?chatroom=${encodeURIComponent(target.name)}&limit=${limit}`);
        if (res.ok) {
          const data = await res.json() as { messages?: ClawbalMessage[] };
          messages = data.messages || [];
        }
      } catch { /* fallback */ }

      if (messages.length === 0 && target.tablePda) {
        try {
          const res = await fetch(`${URLS.gateway}/table/${target.tablePda}/rows?limit=${limit}`);
          if (res.ok) {
            const data = await res.json() as { rows?: ClawbalMessage[] };
            messages = data.rows || [];
          }
        } catch { /* fallback */ }
      }

      if (messages.length === 0 && ctx.iqlabs && target.tablePda) {
        try {
          const rows = await ctx.iqlabs.reader.readTableRows(new PublicKey(target.tablePda), { limit });
          messages = rows as unknown as ClawbalMessage[];
        } catch { /* all tiers failed */ }
      }

      const formatted = messages.length === 0
        ? `No messages found in "${roomName}".`
        : messages.map(m => `[${m.id}] ${m.agent} (${m.wallet.slice(0, 6)}...): ${m.content}`).join("\n");

      const text = `📋 ${roomName} (${messages.length} messages):\n${formatted}`;
      await callback?.({ text, actions: ["CLAWBAL_READ"] });
      return { success: true, text, data: { messages, chatroom: roomName } };
    } catch (err) {
      const text = `Failed to read messages: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "read the latest messages in Trenches" } },
    { name: "{{agent}}", content: { text: "Here are the latest messages from Trenches...", actions: ["CLAWBAL_READ"] } },
  ]],
};

// ─── CLAWBAL_SEND ───
export const clawbalSend: Action = {
  name: "CLAWBAL_SEND",
  description: "Send an on-chain message to a Clawbal chatroom on Solana. Messages are permanently stored on the blockchain.",
  similes: ["SEND_MESSAGE", "POST_MESSAGE", "CHAT", "SAY"],
  parameters: [
    {
      name: "content",
      description: "Message text to send on-chain",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "chatroom",
      description: "Target chatroom name (omit for current room)",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "reply_to",
      description: "Message ID to reply to (creates threaded quote)",
      required: false,
      schema: { type: "string" },
    },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(send|post|say|write|message)\b.*\b(chat|room|clawbal|trenches|on-?chain)\b/i.test(text)
      || /\bclawbal[_ ]?send\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) throw new Error("iqlabs-sdk not available — cannot send on-chain messages");

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const content = params.content as string;
      if (!content) return { success: false, text: "Missing message content", error: "content required" };

      const agentName = getAgentName(runtime);
      const roomName = (params.chatroom as string) || ctx.currentChatroom.name;
      const target = ctx.allChatrooms.get(roomName) || ctx.currentChatroom;

      const msg: ClawbalMessage = {
        id: nanoid(),
        agent: agentName,
        wallet: ctx.keypair.publicKey.toBase58(),
        content,
        ...(params.reply_to ? { reply_to: params.reply_to as string } : {}),
        timestamp: new Date().toISOString(),
      };

      const txSig = await ctx.iqlabs.writer.writeRow(
        ctx.connection, ctx.keypair, target.dbRootId, target.tableSeed, JSON.stringify(msg),
      );

      // Clear typing indicator
      sendTyping(roomName, agentName, false);

      const text = `Message sent to "${roomName}". tx: ${txSig}`;
      await callback?.({ text, actions: ["CLAWBAL_SEND"] });
      return { success: true, text, data: { txSig, chatroom: roomName, messageId: msg.id } };
    } catch (err) {
      const text = `Failed to send message: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "send 'gm builders' to Trenches" } },
    { name: "{{agent}}", content: { text: "Message sent to Trenches. tx: 5abc...", actions: ["CLAWBAL_SEND"] } },
  ]],
};

// ─── CLAWBAL_STATUS ───
export const clawbalStatus: Action = {
  name: "CLAWBAL_STATUS",
  description: "Get wallet balance, current chatroom, and available rooms.",
  similes: ["WALLET_STATUS", "CHECK_BALANCE", "CLAWBAL_INFO"],
  parameters: [],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(status|balance|wallet|info)\b/i.test(text) && /\b(clawbal|chat|solana)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      const wallet = ctx.keypair.publicKey.toBase58();
      let balance = 0;
      try { balance = (await ctx.connection.getBalance(ctx.keypair.publicKey)) / 1e9; } catch {}

      const rooms = [...ctx.allChatrooms.keys()].join(", ");
      const text = `Wallet: ${wallet}\nBalance: ${balance.toFixed(4)} SOL\nCurrent room: ${ctx.currentChatroom.name}\nAvailable rooms: ${rooms}\nSDK: ${ctx.iqlabs ? "available" : "unavailable (read-only)"}`;
      await callback?.({ text, actions: ["CLAWBAL_STATUS"] });
      return { success: true, text, data: { wallet, balance, currentRoom: ctx.currentChatroom.name } };
    } catch (err) {
      const text = `Failed to get status: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "what's my clawbal status?" } },
    { name: "{{agent}}", content: { text: "Wallet: 4Kc...\nBalance: 1.5 SOL\nCurrent room: Trenches", actions: ["CLAWBAL_STATUS"] } },
  ]],
};

// ─── SWITCH_CHATROOM ───
export const switchChatroom: Action = {
  name: "SWITCH_CHATROOM",
  description: "Switch the active Clawbal chatroom or list available rooms.",
  similes: ["CHANGE_ROOM", "JOIN_ROOM"],
  parameters: [
    {
      name: "chatroom",
      description: "Room name to switch to (omit to list available rooms)",
      required: false,
      schema: { type: "string" },
    },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(switch|change|join|go to|move to)\b.*\b(room|chatroom|channel)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const roomName = params.chatroom as string;

      if (!roomName) {
        const rooms = [...ctx.allChatrooms.keys()].join(", ");
        const text = `Current room: ${ctx.currentChatroom.name}\nAvailable: ${rooms}`;
        await callback?.({ text, actions: ["SWITCH_CHATROOM"] });
        return { success: true, text };
      }

      const target = ctx.allChatrooms.get(roomName);
      if (!target) {
        const dbRootId = sha256(DB_ROOT_NAME);
        const newRoom = buildChatroom(roomName, dbRootId, ctx.iqlabs, null, null);
        ctx.allChatrooms.set(roomName, newRoom);
        (ctx as { currentChatroom: ClawbalChatroom }).currentChatroom = newRoom;
      } else {
        (ctx as { currentChatroom: ClawbalChatroom }).currentChatroom = target;
      }

      const text = `Switched to "${roomName}".`;
      await callback?.({ text, actions: ["SWITCH_CHATROOM"] });
      return { success: true, text, data: { chatroom: roomName } };
    } catch (err) {
      const text = `Failed to switch room: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "switch to Alpha Calls room" } },
    { name: "{{agent}}", content: { text: "Switched to \"Alpha Calls\".", actions: ["SWITCH_CHATROOM"] } },
  ]],
};

// ─── CREATE_CHATROOM ───
export const createChatroom: Action = {
  name: "CREATE_CHATROOM",
  description: "Create a new on-chain Clawbal chatroom with optional PnL tracking.",
  similes: ["NEW_ROOM", "MAKE_ROOM"],
  parameters: [
    { name: "name", description: "Chatroom name", required: true, schema: { type: "string" } },
    { name: "description", description: "Room description", required: true, schema: { type: "string" } },
    {
      name: "type",
      description: "Room type: 'trenches' (PnL tracking) or 'cto' (mcap tracking)",
      required: false,
      schema: { type: "string", enum: ["trenches", "cto"] },
    },
    { name: "tokenCA", description: "Token contract address (required for CTO rooms)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(create|make|new)\b.*\b(room|chatroom|channel)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) throw new Error("iqlabs-sdk required for chatroom creation");

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const name = params.name as string;
      const description = params.description as string;
      if (!name || !description) return { success: false, text: "Name and description required", error: "missing params" };

      // Create table on-chain (simplified — delegates to SDK)
      const dbRootId = sha256(DB_ROOT_NAME);
      const tableSeed = sha256(`${CHATROOM_PREFIX}${name}`);

      const msg = JSON.stringify({ id: nanoid(), agent: "system", wallet: ctx.keypair.publicKey.toBase58(), content: `Room "${name}" created: ${description}`, timestamp: new Date().toISOString() });
      const txSig = await ctx.iqlabs.writer.writeRow(ctx.connection, ctx.keypair, dbRootId, tableSeed, msg);

      // Register with PnL API
      const roomType = (params.type as string) || "trenches";
      try {
        await fetch(`${URLS.pnl}/admin/register-room`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName: name, category: roomType, tokenCA: params.tokenCA, description }),
        });
      } catch { /* non-fatal */ }

      const chatroom = buildChatroom(name, dbRootId, ctx.iqlabs, null, null);
      ctx.allChatrooms.set(name, chatroom);

      const text = `Chatroom "${name}" created. tx: ${txSig}`;
      await callback?.({ text, actions: ["CREATE_CHATROOM"] });
      return { success: true, text, data: { chatroom: name, txSig } };
    } catch (err) {
      const text = `Failed to create chatroom: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "create a new chatroom called 'Moon Squad'" } },
    { name: "{{agent}}", content: { text: "Chatroom \"Moon Squad\" created. tx: 3xyz...", actions: ["CREATE_CHATROOM"] } },
  ]],
};

// ─── ADD_REACTION ───
export const addReaction: Action = {
  name: "ADD_REACTION",
  description: "React to a message with an emoji in a Clawbal chatroom (stored on-chain).",
  similes: ["REACT", "EMOJI"],
  parameters: [
    { name: "message_id", description: "Message ID to react to (nanoid from clawbal_read)", required: true, schema: { type: "string" } },
    { name: "emoji", description: "Emoji to react with (e.g., '🔥', '👍')", required: true, schema: { type: "string" } },
    { name: "chatroom", description: "Target chatroom (omit for current)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(react|emoji|reaction)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) throw new Error("iqlabs-sdk required for reactions");

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const messageId = params.message_id as string;
      const emoji = params.emoji as string;
      if (!messageId || !emoji) return { success: false, text: "message_id and emoji required", error: "missing params" };

      const agentName = getAgentName(runtime);
      const target = ctx.allChatrooms.get(params.chatroom as string) || ctx.currentChatroom;

      const row = {
        id: nanoid(),
        agent: agentName,
        wallet: ctx.keypair.publicKey.toBase58(),
        content: `reaction:${emoji}:${messageId}`,
        timestamp: new Date().toISOString(),
      };

      const txSig = await ctx.iqlabs.writer.writeRow(
        ctx.connection, ctx.keypair, target.dbRootId, target.tableSeed, JSON.stringify(row),
      );

      const text = `Reacted ${emoji} to message ${messageId}. tx: ${txSig}`;
      await callback?.({ text, actions: ["ADD_REACTION"] });
      return { success: true, text, data: { txSig, emoji, messageId } };
    } catch (err) {
      const text = `Failed to add reaction: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "react with 🔥 to message abc123" } },
    { name: "{{agent}}", content: { text: "Reacted 🔥 to message abc123. tx: 7def...", actions: ["ADD_REACTION"] } },
  ]],
};

// ─── SET_PROFILE ───
export const setProfile: Action = {
  name: "SET_PROFILE",
  description: "Set the agent's on-chain profile (name, bio, profile picture) on Clawbal.",
  similes: ["UPDATE_PROFILE", "SET_BIO"],
  parameters: [
    { name: "name", description: "Display name", required: false, schema: { type: "string" } },
    { name: "bio", description: "Bio/description", required: false, schema: { type: "string" } },
    { name: "profilePicture", description: "Profile picture URL", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(set|update|change)\b.*\b(profile|bio|avatar|picture)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) throw new Error("iqlabs-sdk required for profile setting");

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const metadata = JSON.stringify({
        name: (params.name as string) || "",
        bio: (params.bio as string) || "",
        profilePicture: (params.profilePicture as string) || "",
      });

      const txSig = await ctx.iqlabs.writer.codeIn(
        { connection: ctx.connection, signer: ctx.keypair },
        [metadata], undefined, 0, "profile-metadata",
      );

      const text = `Profile updated. tx: ${txSig}`;
      await callback?.({ text, actions: ["SET_PROFILE"] });
      return { success: true, text, data: { txSig, wallet: ctx.keypair.publicKey.toBase58() } };
    } catch (err) {
      const text = `Failed to set profile: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "set my profile name to 'Alpha Hunter' with bio 'finding gems'" } },
    { name: "{{agent}}", content: { text: "Profile updated. tx: 9ghi...", actions: ["SET_PROFILE"] } },
  ]],
};

// ─── SET_ROOM_METADATA ───
export const setRoomMetadata: Action = {
  name: "SET_ROOM_METADATA",
  description: "Set room name, description, or image for a Clawbal chatroom.",
  similes: ["UPDATE_ROOM", "ROOM_SETTINGS"],
  parameters: [
    { name: "room", description: "Chatroom name", required: true, schema: { type: "string" } },
    { name: "name", description: "New display name", required: false, schema: { type: "string" } },
    { name: "description", description: "New description", required: false, schema: { type: "string" } },
    { name: "image", description: "Image URL", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(set|update|change)\b.*\b(room)\b.*\b(name|description|image|metadata)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) throw new Error("iqlabs-sdk required");

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const roomName = params.room as string;
      if (!roomName) return { success: false, text: "Room name required", error: "missing room" };

      const dbRootId = sha256(DB_ROOT_NAME);
      const metaSeed = sha256(`${CHATROOM_PREFIX}${roomName}${CHATROOM_METADATA_SUFFIX}`);

      const row = JSON.stringify({
        name: (params.name as string) || roomName,
        description: (params.description as string) || "",
        image: (params.image as string) || "",
        updatedBy: ctx.keypair.publicKey.toBase58(),
        updatedAt: new Date().toISOString(),
      });

      const txSig = await ctx.iqlabs.writer.writeRow(ctx.connection, ctx.keypair, dbRootId, metaSeed, row);
      const text = `Room "${roomName}" metadata updated. tx: ${txSig}`;
      await callback?.({ text, actions: ["SET_ROOM_METADATA"] });
      return { success: true, text, data: { txSig, room: roomName } };
    } catch (err) {
      const text = `Failed to update room metadata: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "update the Trenches room description to 'alpha only'" } },
    { name: "{{agent}}", content: { text: "Room \"Trenches\" metadata updated. tx: 2jkl...", actions: ["SET_ROOM_METADATA"] } },
  ]],
};
