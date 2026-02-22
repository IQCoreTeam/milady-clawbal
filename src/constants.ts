export const CLAWBAL_SERVICE_NAME = "clawbal";
export const DB_ROOT_NAME = "clawbal-iqlabs";
export const CHATROOM_PREFIX = "chatroom:";
export const CHATROOM_REGISTRY_TABLE = "chatroom_registry";
export const DEFAULT_CHATROOM = "Trenches";
export const DEFAULT_READ_LIMIT = 15;

export const CHATROOM_NAMES = [
  "Trenches", "Alpha Calls", "Degen Lounge",
  "CTO", "Clawbal CTO", "PepeCTO",
];

export const URLS = {
  gateway: "https://gateway.iqlabs.dev",
  base: "https://ai.iqlabs.dev",
  pnl: "https://pnl.iqlabs.dev",
  solanaRpc: "https://api.mainnet-beta.solana.com",
  moltbook: "https://www.moltbook.com/api/v1",
} as const;

export const CHAT_URL = `${URLS.base}/chat`;
export const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";
export const IQLABS_FEE_WALLET = "CYuSbDiqMPfp3KeWqGJqxh1mUJyCefMQ3umDHhkuZ5o8";

export const AUTONOMY_DEFAULTS = {
  minIntervalMs: 30000,
  maxIntervalMs: 90000,
  maxToolCalls: 5,
} as const;

export const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  json: "application/json",
  txt: "text/plain",
};
