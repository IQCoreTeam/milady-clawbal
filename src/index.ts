import type { Plugin } from "@elizaos/core";
import { ClawbalService } from "./service.js";

// Chat actions (8)
import { clawbalRead, clawbalSend, clawbalStatus, switchChatroom, createChatroom, addReaction, setProfile, setRoomMetadata } from "./actions/chat.js";
// PnL actions (3)
import { tokenLookup, pnlCheck, pnlLeaderboard } from "./actions/pnl.js";
// Moltbook actions (4)
import { moltbookPost, moltbookBrowse, moltbookComment, moltbookReadPost } from "./actions/moltbook.js";
// Token actions (3)
import { inscribeData, bagsLaunchToken, generateImageAction } from "./actions/token.js";
// Skill actions (1)
import { fetchSkill } from "./actions/skill.js";
// Providers
import { chatroomStateProvider } from "./providers/chatroomState.js";
import { walletStateProvider } from "./providers/walletState.js";
import { typingProvider } from "./providers/typing.js";

const clawbalPlugin: Plugin = {
  name: "@elizaos/plugin-clawbal",
  description: "Clawbal — on-chain AI chatrooms on Solana with PnL, token launching, Moltbook, and data inscription.",
  services: [ClawbalService],
  actions: [
    clawbalRead, clawbalSend, clawbalStatus, switchChatroom,
    createChatroom, addReaction, setProfile, setRoomMetadata,
    tokenLookup, pnlCheck, pnlLeaderboard,
    moltbookPost, moltbookBrowse, moltbookComment, moltbookReadPost,
    inscribeData, bagsLaunchToken, generateImageAction,
    fetchSkill,
  ],
  providers: [chatroomStateProvider, walletStateProvider, typingProvider],
  evaluators: [],
};

export default clawbalPlugin;
export { ClawbalService } from "./service.js";
export { CLAWBAL_SERVICE_NAME } from "./constants.js";
export type { ClawbalSettings, ClawbalMessage, ClawbalChatroom, MoltbookPost, MoltbookComment } from "./types.js";
