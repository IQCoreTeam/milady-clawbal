/**
 * config-sync.ts — On-chain agent config sync via IQLabs Git
 *
 * Reads/writes agent character files to an on-chain "agent-config" repo
 * so that switching between frameworks (Milady/OpenClaw) preserves identity.
 *
 * On-chain repo structure:
 *   agent-config/
 *     milady/character.json
 *     openclaw/SOUL.md
 *     openclaw/IDENTITY.md
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { createRequire } from "module";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { IQLabsSDK } from "./types.js";

const GIT_ROOT_ID = "iq-git-v1";
const REPO_NAME = "agent-config";
const REPOS_TABLE = "git_repos_v2";
const COMMITS_TABLE = "git_commits";

const FRONTEND_BASE_URL = "https://git.iqlabs.dev";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Owner-scoped table seed: sha256(tableName + "_" + ownerAddress) */
function ownerTableSeed(tableName: string, ownerAddress: string): Buffer {
  return sha256(tableName + "_" + ownerAddress);
}

function getProgramId(iqlabs: IQLabsSDK): PublicKey {
  return typeof iqlabs.contract.getProgramId === "function"
    ? iqlabs.contract.getProgramId()
    : new PublicKey((iqlabs.contract as any).DEFAULT_ANCHOR_PROGRAM_ID);
}

// ─── Core read/write operations ───

/**
 * Check if the agent-config repo exists on-chain for this wallet.
 * Returns the latest commit's file tree if it exists, null otherwise.
 */
export async function checkOnChain(
  connection: Connection,
  keypair: Keypair,
  iqlabs: IQLabsSDK,
): Promise<Record<string, { txId: string; hash: string }> | null> {
  const programId = getProgramId(iqlabs);
  const dbRootId = sha256(GIT_ROOT_ID);
  const dbRootPda = iqlabs.contract.getDbRootPda(dbRootId, programId);
  const wallet = keypair.publicKey.toBase58();
  const tableSeed = ownerTableSeed(COMMITS_TABLE, wallet);
  const tablePda = iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId);

  try {
    // Quick existence check — 1 RPC call instead of heavy readTableRows
    const info = await connection.getAccountInfo(tablePda);
    if (!info) return null;

    const rows = await iqlabs.reader.readTableRows(tablePda);
    const commits = (rows as any[])
      .filter((c: any) => c.repoName === REPO_NAME)
      .sort((a: any, b: any) => b.timestamp - a.timestamp);

    if (commits.length === 0) return null;

    const treeResult = await iqlabs.reader.readCodeIn(commits[0].treeTxId);
    if (!treeResult.data) return null;
    return JSON.parse(treeResult.data);
  } catch (err) {
    console.error(`[config-sync] checkOnChain error: ${err}`);
    return { __error: true } as any;
  }
}

/**
 * Pull a specific file from on-chain by its txId.
 * Returns the decoded content as a string.
 */
export async function pullFile(
  iqlabs: IQLabsSDK,
  txId: string,
): Promise<string> {
  const result = await iqlabs.reader.readCodeIn(txId);
  if (!result.data) throw new Error(`Failed to read file from tx ${txId}`);
  // Files are stored as base64 in git commits
  return Buffer.from(result.data, "base64").toString("utf-8");
}

/**
 * Push files to the on-chain agent-config repo.
 * Creates the repo if it doesn't exist.
 * files: Record<relativePath, content string>
 */
export async function pushToChain(
  connection: Connection,
  keypair: Keypair,
  iqlabs: IQLabsSDK,
  files: Record<string, string>,
  message: string = "sync agent config",
): Promise<string> {
  const programId = getProgramId(iqlabs);
  const dbRootId = sha256(GIT_ROOT_ID);
  const dbRootPda = iqlabs.contract.getDbRootPda(dbRootId, programId);
  const wallet = keypair.publicKey.toBase58();

  // Ensure DB root exists
  const rootInfo = await connection.getAccountInfo(dbRootPda);
  if (!rootInfo) {
    const require_ = createRequire(import.meta.url);
    const idl = require_("iqlabs-sdk/idl/code_in.json");
    const builder = iqlabs.contract.createInstructionBuilder(idl, programId);
    const ix = iqlabs.contract.initializeDbRootInstruction(builder, {
      db_root: dbRootPda,
      signer: keypair.publicKey,
      system_program: SystemProgram.programId,
    }, { db_root_id: dbRootId });
    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keypair]);
  }

  // Rate-limit-safe delay for free RPCs
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Ensure repos table exists (owner-scoped)
  await ensureTable(connection, keypair, iqlabs, dbRootId, REPOS_TABLE, ["name", "description", "owner", "timestamp", "isPublic"], wallet);
  await delay(2000);
  await ensureTable(connection, keypair, iqlabs, dbRootId, COMMITS_TABLE, ["id", "repoName", "message", "author", "timestamp", "treeTxId", "parentCommitId"], wallet);
  await delay(2000);

  // Create repo if it doesn't exist
  const reposSeed = ownerTableSeed(REPOS_TABLE, wallet);
  const reposTable = iqlabs.contract.getTablePda(dbRootPda, reposSeed, programId);
  try {
    const repos = await iqlabs.reader.readTableRows(reposTable);
    const exists = (repos as any[]).some((r: any) => r.name === REPO_NAME && r.owner === wallet);
    if (!exists) {
      await iqlabs.writer.writeRow(connection, keypair, dbRootId, reposSeed, JSON.stringify({
        name: REPO_NAME,
        description: "Agent character config (auto-synced)",
        owner: wallet,
        timestamp: Date.now(),
        isPublic: true,
      }));
      console.log(`Created on-chain repo: ${REPO_NAME}`);
      await delay(2000);
    }
  } catch {
    // Table might be empty, create repo
    await iqlabs.writer.writeRow(connection, keypair, dbRootId, reposSeed, JSON.stringify({
      name: REPO_NAME,
      description: "Agent character config (auto-synced)",
      owner: wallet,
      timestamp: Date.now(),
      isPublic: true,
    }));
    await delay(2000);
  }
  const fileTree: Record<string, { txId: string; hash: string }> = {};
  let first = true;
  for (const [path, content] of Object.entries(files)) {
    if (!first) await delay(2000);
    first = false;

    const encoded = Buffer.from(content).toString("base64");
    const hash = sha256(encoded).toString("hex");

    console.log(`Uploading ${path}...`);
    const txId = await iqlabs.writer.codeIn(
      { connection, signer: keypair },
      encoded,
      path.split("/").pop() || "file",
      0,
      "application/octet-stream",
    );
    fileTree[path] = { txId, hash };
  }

  // Upload file tree manifest
  await delay(2000);
  const treeJson = JSON.stringify(fileTree);
  const treeTxId = await iqlabs.writer.codeIn(
    { connection, signer: keypair },
    treeJson,
    "tree.json",
    0,
    "application/json",
  );

  // Record commit
  await delay(2000);
  const commitsSeed = ownerTableSeed(COMMITS_TABLE, wallet);
  const commitId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await iqlabs.writer.writeRow(connection, keypair, dbRootId, commitsSeed, JSON.stringify({
    id: commitId,
    repoName: REPO_NAME,
    message,
    author: wallet,
    timestamp: Date.now(),
    treeTxId,
  }));

  console.log(`Config synced on-chain! View at: ${getConfigUrl(wallet)}`);
  return commitId;
}

/**
 * Get the browsable URL for this wallet's agent-config repo.
 */
export function getConfigUrl(walletAddress: string): string {
  return `${FRONTEND_BASE_URL}/${walletAddress}/${REPO_NAME}`;
}

// ─── Table infrastructure ───

async function ensureTable(
  connection: Connection,
  keypair: Keypair,
  iqlabs: IQLabsSDK,
  dbRootId: Buffer,
  tableName: string,
  columns: string[],
  ownerAddress: string,
): Promise<void> {
  const programId = getProgramId(iqlabs);
  const dbRootPda = iqlabs.contract.getDbRootPda(dbRootId, programId);
  const tableSeed = ownerTableSeed(tableName, ownerAddress);
  const tablePda = iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId);

  const info = await connection.getAccountInfo(tablePda);
  if (info) return;

  const require_ = createRequire(import.meta.url);
  const idl = require_("iqlabs-sdk/idl/code_in.json");
  const builder = iqlabs.contract.createInstructionBuilder(idl, programId);
  const idCol = columns.find(c => c === "id" || c === "name") || columns[0];

  const ix = iqlabs.contract.createTableInstruction(builder, {
    db_root: dbRootPda,
    receiver: keypair.publicKey,
    signer: keypair.publicKey,
    table: tablePda,
    instruction_table: iqlabs.contract.getInstructionTablePda(dbRootPda, tableSeed, programId),
    system_program: SystemProgram.programId,
  }, {
    db_root_id: Buffer.from(dbRootId),
    table_seed: Buffer.from(tableSeed),
    table_name: Buffer.from(tableName),
    column_names: columns.map(c => Buffer.from(c)),
    id_col: Buffer.from(idCol),
    ext_keys: [],
    gate_mint_opt: null,
    writers_opt: null,
  });

  console.log(`Creating table '${tableName}'...`);
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keypair]);
}

// ─── Config format conversion ───

const SOUL_TEMPLATE = `# SOUL

You are an on-chain AI that lives in Clawbal chatrooms on Solana.

## who you are
- You read the room before speaking
- You reply when mentioned or when you have something to add
- You stay silent when the conversation doesn't need you
- You never spam, never use markdown, speak naturally like texting
- If something breaks, you say so honestly

## how you talk
- Match the energy of the room
- Keep messages short and natural
- No emojis unless the room uses them
- No bullet points or formatting in chat

## engagement modes
1. REACT — short reaction to what someone said
2. DISCUSS — join a thread with a real take
3. SHARE — drop something relevant unprompted
4. SILENT — say nothing (default when unsure)

`;

/**
 * Generate OpenClaw IDENTITY.md from a character name, creature, and vibe.
 */
export function generateIdentityMd(name: string, creature: string, vibe: string): string {
  return `- Name: ${name}\n- Creature: ${creature}\n- Vibe: ${vibe}\n`;
}

/**
 * Generate OpenClaw SOUL.md with custom personality section appended to template.
 */
export function generateSoulMd(personality: string): string {
  return SOUL_TEMPLATE + `## personality\n${personality}\n`;
}

/**
 * Convert ElizaOS character.json to OpenClaw SOUL.md + IDENTITY.md
 */
export function elizaToOpenClaw(character: {
  name: string;
  bio?: string[];
  style?: { all?: string[] };
}): { soul: string; identity: string } {
  const name = character.name || "Agent";
  const bio = character.bio || [];
  const styles = character.style?.all || [];

  const creature = bio[0] || "on-chain AI";
  const vibe = styles.slice(0, 3).join(". ") || "curious, direct, helpful";
  const personality = [...bio.slice(1), ...styles.slice(3)].join("\n- ") || "observant and helpful";

  return {
    soul: generateSoulMd(`- ${personality}`),
    identity: generateIdentityMd(name, creature, vibe),
  };
}

/**
 * Convert OpenClaw SOUL.md + IDENTITY.md to ElizaOS character.json
 */
export function openClawToEliza(soul: string, identity: string): {
  name: string;
  plugins: string[];
  settings: { model: string; voice: { model: string } };
  bio: string[];
  style: { all: string[] };
} {
  // Parse IDENTITY.md
  const nameMatch = identity.match(/- Name:\s*(.+)/);
  const creatureMatch = identity.match(/- Creature:\s*(.+)/);
  const vibeMatch = identity.match(/- Vibe:\s*(.+)/);

  const name = nameMatch?.[1]?.trim() || "Agent";
  const creature = creatureMatch?.[1]?.trim() || "on-chain AI";
  const vibeStr = vibeMatch?.[1]?.trim() || "curious, direct, helpful";

  // Parse personality from SOUL.md
  const personalityMatch = soul.match(/## personality\n([\s\S]*?)(?:\n##|$)/);
  const personalityLines = personalityMatch?.[1]
    ?.split("\n")
    .map(l => l.replace(/^-\s*/, "").trim())
    .filter(Boolean) || [];

  return {
    name,
    plugins: ["@iqlabs-official/plugin-clawbal"],
    settings: {
      model: "openrouter/deepseek/deepseek-v3.2",
      voice: { model: "en_US-male-medium" },
    },
    bio: [creature, ...personalityLines],
    style: { all: vibeStr.split(/[.,]\s*/).map(s => s.trim()).filter(Boolean) },
  };
}

// ─── Startup auto-sync ───

/**
 * localFiles: mapping of on-chain path → local file path
 *   e.g. { "openclaw/SOUL.md": "/home/user/.openclaw/workspace/SOUL.md",
 *          "milady/character.json": "/home/user/milady/characters/agent.character.json" }
 *
 * Behavior:
 * - No on-chain config → push local files + cross-generate missing formats
 * - On-chain exists, no local → pull from on-chain
 * - Both exist, different → pull on-chain, backup local as .backup
 * - Both exist, same → no-op
 */
export async function runConfigSync(
  connection: Connection,
  keypair: Keypair,
  iqlabs: IQLabsSDK,
  localFiles: Record<string, string>,
  log: (msg: string) => void,
): Promise<void> {
  const wallet = keypair.publicKey.toBase58();
  const tree = await checkOnChain(connection, keypair, iqlabs);

  // If checkOnChain failed due to RPC error, don't re-push — just skip
  if (tree && (tree as any).__error) {
    log(`[config-sync] Could not read on-chain state (RPC error), skipping to avoid duplicate push.`);
    return;
  }

  if (!tree) {
    // No on-chain config — push local files
    const filesToPush: Record<string, string> = {};
    for (const [onChainPath, localPath] of Object.entries(localFiles)) {
      if (existsSync(localPath)) {
        filesToPush[onChainPath] = readFileSync(localPath, "utf-8");
      }
    }

    if (Object.keys(filesToPush).length === 0) {
      log(`[config-sync] No local config files found, skipping.`);
      return;
    }

    // Cross-generate missing formats before pushing
    const hasOpenClaw = filesToPush["openclaw/SOUL.md"] && filesToPush["openclaw/IDENTITY.md"];
    const hasMilady = filesToPush["milady/character.json"];

    if (hasMilady && !hasOpenClaw) {
      const character = JSON.parse(filesToPush["milady/character.json"]);
      const { soul, identity } = elizaToOpenClaw(character);
      filesToPush["openclaw/SOUL.md"] = soul;
      filesToPush["openclaw/IDENTITY.md"] = identity;
      log(`[config-sync] Generated openclaw/SOUL.md + IDENTITY.md from character.json`);
    } else if (hasOpenClaw && !hasMilady) {
      const character = openClawToEliza(filesToPush["openclaw/SOUL.md"], filesToPush["openclaw/IDENTITY.md"]);
      filesToPush["milady/character.json"] = JSON.stringify(character, null, 2) + "\n";
      log(`[config-sync] Generated milady/character.json from SOUL.md + IDENTITY.md`);
    }

    log(`[config-sync] Pushing ${Object.keys(filesToPush).length} file(s) to on-chain...`);
    await pushToChain(connection, keypair, iqlabs, filesToPush);

    log(`[config-sync] Config synced! View at: ${getConfigUrl(wallet)}`);
    return;
  }

  // On-chain config exists — check each file
  const hasLocalFiles = Object.values(localFiles).some(p => existsSync(p));

  if (!hasLocalFiles) {
    // No local files — pull everything from on-chain
    log(`[config-sync] Found on-chain config, pulling to local...`);
    for (const [onChainPath, entry] of Object.entries(tree)) {
      const localPath = localFiles[onChainPath];
      if (!localPath) continue;
      const content = await pullFile(iqlabs, entry.txId);
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, content);
      log(`[config-sync] Pulled: ${onChainPath} → ${localPath}`);
    }

    return;
  }

  // Both exist — compare hashes and pull if different (backup local)
  let anyDiff = false;
  for (const [onChainPath, entry] of Object.entries(tree)) {
    const localPath = localFiles[onChainPath];
    if (!localPath || !existsSync(localPath)) continue;

    const localContent = readFileSync(localPath, "utf-8");
    const localHash = sha256(Buffer.from(localContent).toString("base64")).toString("hex");

    if (localHash !== entry.hash) {
      anyDiff = true;
      const backupPath = localPath + ".backup";
      renameSync(localPath, backupPath);
      log(`[config-sync] Local differs from on-chain: ${onChainPath} — backed up to ${backupPath}`);

      const content = await pullFile(iqlabs, entry.txId);
      writeFileSync(localPath, content);
      log(`[config-sync] Pulled on-chain version: ${onChainPath}`);
    }
  }

  // Also pull files that exist on-chain but not locally
  for (const [onChainPath, entry] of Object.entries(tree)) {
    const localPath = localFiles[onChainPath];
    if (!localPath || existsSync(localPath)) continue;

    const content = await pullFile(iqlabs, entry.txId);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, content);
    log(`[config-sync] Pulled missing file: ${onChainPath} → ${localPath}`);
  }

  if (!anyDiff) {
    log(`[config-sync] Local and on-chain configs match. View at: ${getConfigUrl(wallet)}`);
  }
}
