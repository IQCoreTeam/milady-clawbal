/**
 * @elizaos/app-clawbal — Clawbal Chat plugin for ElizaOS/Milady.
 *
 * On-chain AI chatrooms on Solana with PnL tracking, token launching,
 * Moltbook social, and permanent data inscription.
 */
import type { Plugin } from "@elizaos/core";
import { connectNotiWs, disconnectNotiWs, sendTyping } from "./noti-ws.js";
import { getContext, getAgentName } from "./sdk.js";

// Chat actions (8)
import {
  clawbalRead,
  clawbalSend,
  clawbalStatus,
  switchChatroom,
  createChatroom,
  addReaction,
  setProfile,
  setRoomMetadata,
} from "./chat-actions.js";

// PnL actions (3)
import {
  tokenLookup,
  pnlCheck,
  pnlLeaderboard,
} from "./pnl-actions.js";

// Moltbook actions (4)
import {
  moltbookPost,
  moltbookBrowse,
  moltbookComment,
  moltbookReadPost,
} from "./moltbook-actions.js";

// Token actions (3)
import {
  bagsLaunchToken,
  inscribeData,
  generateImage,
} from "./token-actions.js";

// Skill actions (1)
import { fetchSkill } from "./skill-actions.js";

const clawbalPlugin: Plugin = {
  name: "@elizaos/app-clawbal",
  description: "Clawbal — on-chain AI chatrooms on Solana with PnL, token launching, Moltbook social, and data inscription.",

  async init(_config, _runtime) {
    connectNotiWs();
  },

  actions: [
    // Chat
    clawbalRead,
    clawbalSend,
    clawbalStatus,
    switchChatroom,
    createChatroom,
    addReaction,
    setProfile,
    setRoomMetadata,
    // PnL
    tokenLookup,
    pnlCheck,
    pnlLeaderboard,
    // Moltbook
    moltbookPost,
    moltbookBrowse,
    moltbookComment,
    moltbookReadPost,
    // Token
    bagsLaunchToken,
    inscribeData,
    generateImage,
    // Skill
    fetchSkill,
  ],
  providers: [
    {
      name: "clawbal-typing",
      description: "Sends typing indicator when agent starts processing",
      async get(runtime, _message, _state) {
        try {
          const ctx = await getContext(runtime);
          const room = ctx.currentChatroom.name;
          const agent = getAgentName(runtime);
          sendTyping(room, agent, true);
        } catch {
          // Non-fatal — don't break agent turn
        }
        return { text: "" };
      },
    },
  ],
  evaluators: [],
};

export default clawbalPlugin;
