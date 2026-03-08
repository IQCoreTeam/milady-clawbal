import type { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface ClawbalSettings {
  rpcUrl: string;
  privateKey?: string;
  agentName: string;
  chatroom: string;
  moltbookToken?: string;
  pnlApiUrl?: string;
  gatewayUrl?: string;
  bagsApiKey?: string;
  imageApiKey?: string;
  autonomyIntervalMs?: number;
  autonomyMaxSteps?: number;
  autonomousMode?: boolean;
}

export interface ClawbalMessage {
  id: string;
  agent: string;
  wallet: string;
  content: string;
  timestamp: string;
  bot_message?: boolean;
  reply_to?: string;
  tx_sig?: string;
}

export interface ClawbalChatroom {
  name: string;
  dbRootId: Buffer;
  tableSeed: Buffer;
  tablePda: string;
}

export interface IQLabsSDK {
  contract: {
    getProgramId?(): PublicKey;
    PROGRAM_ID?: PublicKey;
    DEFAULT_ANCHOR_PROGRAM_ID?: string;
    getDbRootPda(dbRootId: Buffer, programId: PublicKey): PublicKey;
    getTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    getInstructionTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    createInstructionBuilder(idl: unknown, programId: PublicKey): unknown;
    createTableInstruction(builder: unknown, accounts: Record<string, PublicKey>, args: Record<string, unknown>): TransactionInstruction;
    initializeDbRootInstruction(builder: unknown, accounts: Record<string, PublicKey>, args: { db_root_id: Buffer }): TransactionInstruction;
  };
  writer: {
    writeRow(connection: Connection, keypair: Keypair, dbRootId: Buffer, tableSeed: Buffer, data: string): Promise<string>;
    codeIn(ctx: { connection: Connection; signer: Keypair }, data: string | string[], filename?: string, method?: number, filetype?: string): Promise<string>;
  };
  reader: {
    readTableRows(tablePda: PublicKey, options?: { limit: number }): Promise<ClawbalMessage[]>;
    readCodeIn(txId: string): Promise<{ data: string | null }>;
  };
}

export interface PnlTokenInfo {
  [key: string]: unknown;
  tokenCA: string;
  mcap: number;
  price: number;
  name: string;
  symbol: string;
  dex: string;
  volume24h: number;
  liquidity: number;
  priceChange1h: number;
  priceChange24h: number;
  buys1h: number;
  sells1h: number;
}

export interface PnlUserCallsResponse {
  [key: string]: unknown;
  calls: {
    tokenCA: string;
    firstCallTs: string;
    firstCallMcap: number;
    currentMcap: number | null;
    pnlPercent: number;
  }[];
  stats: {
    totalCalls: number;
    hitRate: number;
    avgReturn: number;
    medReturn: number;
  };
}

export interface PnlLeaderboardEntry {
  [key: string]: unknown;
  userWallet: string;
  tokenCA: string;
  entryMcap: number;
  currentMcap: number | null;
  pnlPercent: number;
}

export interface MoltbookPost {
  id: string;
  title: string;
  content?: string;
  body?: string;
  submolt?: { name: string };
  author?: { name: string };
  upvotes?: number;
  comment_count?: number;
  created_at?: string;
}

export interface MoltbookComment {
  id: string;
  content: string;
  author?: { name: string };
  created_at?: string;
  parent_id?: string;
}

export const ClawbalEventTypes = {
  MESSAGE_RECEIVED: "clawbal.message.received",
  MESSAGE_SENT: "clawbal.message.sent",
  DATA_INSCRIBED: "clawbal.data.inscribed",
  MOLTBOOK_POST_CREATED: "clawbal.moltbook.post.created",
  MOLTBOOK_COMMENT_CREATED: "clawbal.moltbook.comment.created",
} as const;
