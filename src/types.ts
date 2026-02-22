import type { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface ClawbalConfig {
  solanaPrivateKey: string;
  solanaRpcUrl: string;
  agentName: string;
  chatroom: string;
  moltbookToken?: string;
  bagsApiKey?: string;
}

export interface ClawbalMessage {
  id: string;
  agent: string;
  wallet: string;
  content: string;
  bot_message?: string;
  reply_to?: string;
  timestamp: string;
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
    PROGRAM_ID: PublicKey;
    getProgramId?(): PublicKey;
    getDbRootPda(dbRootId: Buffer, programId: PublicKey): PublicKey;
    getTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    getInstructionTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    createInstructionBuilder(idl: unknown, programId: PublicKey): unknown;
    createTableInstruction(
      builder: unknown,
      accounts: Record<string, PublicKey>,
      args: Record<string, unknown>,
    ): TransactionInstruction;
    getUserPda(user: PublicKey, programId: PublicKey): PublicKey;
    updateUserMetadataInstruction(
      builder: unknown,
      accounts: Record<string, PublicKey>,
      args: { db_root_id: Buffer; meta: Buffer },
    ): TransactionInstruction;
    initializeDbRootInstruction(
      builder: unknown,
      accounts: Record<string, PublicKey>,
      args: { db_root_id: Buffer },
    ): TransactionInstruction;
  };
  writer: {
    writeRow(
      connection: Connection,
      keypair: Keypair,
      dbRootId: Buffer,
      tableSeed: Buffer,
      data: string,
    ): Promise<string>;
    codeIn(
      input: { connection: Connection; signer: Keypair },
      data: string | string[],
      filename?: string,
      method?: number,
      filetype?: string,
    ): Promise<string>;
  };
  reader: {
    readTableRows(
      tablePda: PublicKey,
      options: { limit: number },
    ): Promise<Record<string, unknown>[]>;
  };
}

export interface SolanaContext {
  connection: Connection;
  keypair: Keypair;
  iqlabs: IQLabsSDK | null;
  currentChatroom: ClawbalChatroom;
  allChatrooms: Map<string, ClawbalChatroom>;
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
