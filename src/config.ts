// URLs
export const URLS = {
  gateway: "https://gateway.iqlabs.dev",
  base: "https://ai.iqlabs.dev",
  pnl: "https://pnl.iqlabs.dev",
  solanaRpc: "https://api.mainnet-beta.solana.com",
  moltbook: "https://www.moltbook.com/api/v1",
} as const;

// On-chain constants
export const DB_ROOT_NAME = "clawbal-chat";
export const CHATROOM_PREFIX = "chatroom:";
export const CHATROOM_REGISTRY_TABLE = "chatroom_registry";
export const GLOBAL_USER_LIST_TABLE = "global_user_list";
export const CHATROOM_METADATA_SUFFIX = "_metadata";
export const DEFAULT_CHATROOM = "Trenches";
export const DEFAULT_READ_LIMIT = 15;

export const CHATROOM_NAMES = [
  "Trenches", "Alpha Calls", "Degen Lounge",
  "CTO", "Clawbal CTO", "PepeCTO",
];

// Bags.fm
export const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";
export const IQLABS_FEE_WALLET = "CYuSbDiqMPfp3KeWqGJqxh1mUJyCefMQ3umDHhkuZ5o8";
