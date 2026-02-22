/**
 * IQLabs SDK lazy initialization and Solana context management.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import bs58 from "bs58";
import type { IAgentRuntime } from "@elizaos/core";
import type { IQLabsSDK, SolanaContext, ClawbalChatroom } from "./types.js";
import {
  DB_ROOT_NAME, CHATROOM_PREFIX, CHATROOM_NAMES, DEFAULT_CHATROOM, URLS,
} from "./config.js";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function getProgramId(iqlabs: IQLabsSDK): PublicKey {
  return typeof iqlabs.contract.getProgramId === "function"
    ? iqlabs.contract.getProgramId()
    : iqlabs.contract.PROGRAM_ID;
}

export function buildChatroom(
  name: string,
  dbRootId: Buffer,
  iqlabs: IQLabsSDK | null,
  dbRootPda: PublicKey | null,
  programId: PublicKey | null,
): ClawbalChatroom {
  const tableSeed = sha256(`${CHATROOM_PREFIX}${name}`);
  let tablePda = "";
  if (iqlabs && dbRootPda && programId) {
    tablePda = iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId).toBase58();
  }
  return { name, dbRootId, tableSeed, tablePda };
}

// Singleton context — initialized once per runtime
let cachedContext: SolanaContext | null = null;

/**
 * Get or initialize the Solana context from runtime settings.
 */
export async function getContext(runtime: IAgentRuntime): Promise<SolanaContext> {
  if (cachedContext) return cachedContext;

  const privKey = runtime.getSetting("SOLANA_PRIVATE_KEY") || "";
  if (!privKey) throw new Error("SOLANA_PRIVATE_KEY not configured");

  const rpcUrl = runtime.getSetting("SOLANA_RPC_URL") || URLS.solanaRpc;
  const connection = new Connection(rpcUrl, "confirmed");

  // Decode keypair
  let keypair: Keypair;
  const keyStr = privKey.trim();
  if (keyStr.startsWith("[")) {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyStr)));
  } else {
    keypair = Keypair.fromSecretKey(bs58.decode(keyStr));
  }

  // Try to import iqlabs-sdk
  let iqlabs: IQLabsSDK | null = null;
  try {
    const mod = await import("iqlabs-sdk");
    iqlabs = (mod.default || mod) as unknown as IQLabsSDK;
  } catch {
    // SDK not available — read-only mode
  }

  const dbRootId = sha256(DB_ROOT_NAME);
  let programId: PublicKey | null = null;
  let dbRootPda: PublicKey | null = null;

  if (iqlabs) {
    programId = getProgramId(iqlabs);
    dbRootPda = iqlabs.contract.getDbRootPda(dbRootId, programId);
  }

  const allChatrooms = new Map<string, ClawbalChatroom>();
  for (const name of CHATROOM_NAMES) {
    allChatrooms.set(name, buildChatroom(name, dbRootId, iqlabs, dbRootPda, programId));
  }

  const chatroomName = runtime.getSetting("CLAWBAL_CHATROOM") || DEFAULT_CHATROOM;
  const currentChatroom = allChatrooms.get(chatroomName)
    || buildChatroom(chatroomName, dbRootId, iqlabs, dbRootPda, programId);
  if (!allChatrooms.has(chatroomName)) {
    allChatrooms.set(chatroomName, currentChatroom);
  }

  cachedContext = { connection, keypair, iqlabs, currentChatroom, allChatrooms };
  return cachedContext;
}

export function getAgentName(runtime: IAgentRuntime): string {
  return runtime.getSetting("CLAWBAL_AGENT_NAME")
    || runtime.character?.name
    || "ClawbalAgent";
}

export { sha256 };
