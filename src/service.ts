import { type IAgentRuntime, Service, logger } from "@elizaos/core";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { basename, extname } from "path";
import { nanoid } from "nanoid";
import bs58 from "bs58";

import {
  CLAWBAL_SERVICE_NAME, DB_ROOT_NAME, CHATROOM_PREFIX, CHATROOM_NAMES,
  URLS, BAGS_BASE, IQLABS_FEE_WALLET, MIME_TYPES,
} from "./constants.js";
import { getClawbalSettings } from "./environment.js";
import {
  type ClawbalSettings, type ClawbalMessage, type ClawbalChatroom,
  type IQLabsSDK, type MoltbookPost, type MoltbookComment,
  ClawbalEventTypes,
} from "./types.js";

function sha256(s: string): Buffer { return createHash("sha256").update(s).digest(); }

function resolveFilePath(input: string): string | null {
  let p = input.trim();
  if (p.startsWith("file://")) p = p.slice(7);
  if (p.startsWith("/") && existsSync(p)) return p;
  return null;
}

export class ClawbalService extends Service {
  static serviceType: string = CLAWBAL_SERVICE_NAME;
  capabilityDescription = "On-chain chat, PnL tracking, token launching, Moltbook social, and data inscription on Solana";

  private settings!: ClawbalSettings;
  private connection!: Connection;
  private keypair!: Keypair;
  private iqlabs: IQLabsSDK | null = null;
  private dbRootId!: Buffer;
  private programId: PublicKey | null = null;
  private dbRootPda: PublicKey | null = null;
  private currentChatroom!: ClawbalChatroom;
  private allChatrooms = new Map<string, ClawbalChatroom>();

  constructor(protected runtime: IAgentRuntime) { super(); }

  static async start(runtime: IAgentRuntime): Promise<ClawbalService> {
    const svc = new ClawbalService(runtime);
    await svc.initialize();
    return svc;
  }

  private async initialize(): Promise<void> {
    this.settings = getClawbalSettings(this.runtime);

    const privKey = this.settings.privateKey;
    if (!privKey) throw new Error("SOLANA_PRIVATE_KEY required");

    this.connection = new Connection(this.settings.rpcUrl, "confirmed");

    if (privKey.startsWith("[")) {
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privKey)));
    } else {
      this.keypair = Keypair.fromSecretKey(bs58.decode(privKey));
    }

    try {
      const mod = await import("@iqlabs-official/solana-sdk");
      this.iqlabs = (mod.default || mod) as unknown as IQLabsSDK;
      logger.info("iqlabs-sdk loaded — full write capability");
    } catch {
      logger.warn("iqlabs-sdk not available — read-only mode");
    }

    this.dbRootId = sha256(DB_ROOT_NAME);
    if (this.iqlabs) {
      this.programId = typeof this.iqlabs.contract.getProgramId === "function"
        ? this.iqlabs.contract.getProgramId()
        : this.iqlabs.contract.PROGRAM_ID!;
      this.dbRootPda = this.iqlabs.contract.getDbRootPda(this.dbRootId, this.programId);
    }

    for (const name of CHATROOM_NAMES) {
      this.allChatrooms.set(name, this.buildChatroom(name));
    }
    this.switchChatroom(this.settings.chatroom);

    logger.info(`Clawbal service started — wallet ${this.keypair.publicKey.toBase58()}, room ${this.settings.chatroom}`);
  }

  async stop(): Promise<void> { logger.info("Clawbal service stopped"); }

  private buildChatroom(name: string): ClawbalChatroom {
    const tableSeed = sha256(`${CHATROOM_PREFIX}${name}`);
    let tablePda = "";
    if (this.iqlabs && this.dbRootPda && this.programId) {
      tablePda = this.iqlabs.contract.getTablePda(this.dbRootPda, tableSeed, this.programId).toBase58();
    }
    return { name, dbRootId: this.dbRootId, tableSeed, tablePda };
  }

  // ─── Getters ───
  getConnection(): Connection { return this.connection; }
  getKeypair(): Keypair { return this.keypair; }
  getIqlabs(): IQLabsSDK | null { return this.iqlabs; }
  getSettings(): ClawbalSettings { return this.settings; }
  getWalletAddress(): string { return this.keypair.publicKey.toBase58(); }
  getCurrentChatroom(): string { return this.currentChatroom.name; }
  getCurrentChatroomObj(): ClawbalChatroom { return this.currentChatroom; }
  getAllChatrooms(): Map<string, ClawbalChatroom> { return this.allChatrooms; }
  getAgentName(): string { return this.settings.agentName; }

  async getBalance(): Promise<number> {
    try { return (await this.connection.getBalance(this.keypair.publicKey)) / 1e9; }
    catch { return 0; }
  }

  // ─── Chatroom ───
  switchChatroom(name: string): void {
    let room = this.allChatrooms.get(name);
    if (!room) {
      room = this.buildChatroom(name);
      this.allChatrooms.set(name, room);
    }
    this.currentChatroom = room;
  }

  async createChatroom(name: string, description?: string, type?: string, tokenCA?: string): Promise<void> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required for chatroom creation");
    const room = this.buildChatroom(name);
    this.allChatrooms.set(name, room);
  }

  // ─── Messages ───
  async sendMessage(content: string, replyTo?: string): Promise<string> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required to send on-chain messages");
    const msg: ClawbalMessage = {
      id: nanoid(), agent: this.settings.agentName,
      wallet: this.getWalletAddress(), content,
      timestamp: new Date().toISOString(),
      ...(replyTo ? { reply_to: replyTo } : {}),
    };
    const txSig = await this.iqlabs.writer.writeRow(
      this.connection, this.keypair, this.currentChatroom.dbRootId,
      this.currentChatroom.tableSeed, JSON.stringify(msg),
    );
    return txSig;
  }

  async readMessages(limit = 15, chatroomName?: string): Promise<ClawbalMessage[]> {
    const room = chatroomName || this.currentChatroom.name;
    try {
      const res = await fetch(`${URLS.base}/api/v1/messages?chatroom=${encodeURIComponent(room)}&limit=${limit}`);
      if (res.ok) { const d = await res.json(); return (d.messages || []) as ClawbalMessage[]; }
    } catch { /* fallback */ }
    if (this.iqlabs && this.currentChatroom.tablePda) {
      try {
        const tablePda = new PublicKey(this.currentChatroom.tablePda);
        return await this.iqlabs.reader.readTableRows(tablePda, { limit }) as ClawbalMessage[];
      } catch { /* ignore */ }
    }
    return [];
  }

  async addReaction(messageId: string, emoji: string, chatroomName?: string): Promise<string> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required for reactions");
    const room = chatroomName ? (this.allChatrooms.get(chatroomName) || this.buildChatroom(chatroomName)) : this.currentChatroom;
    const row = JSON.stringify({ id: nanoid(), agent: this.settings.agentName, wallet: this.getWalletAddress(), content: `reaction:${emoji}:${messageId}`, timestamp: new Date().toISOString() });
    return this.iqlabs.writer.writeRow(this.connection, this.keypair, room.dbRootId, room.tableSeed, row);
  }

  // ─── Profile ───
  async setProfile(name?: string, bio?: string, profilePicture?: string): Promise<string> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required for profile setting");
    const metadata = JSON.stringify({ name: name || this.settings.agentName, bio: bio || "", profilePicture: profilePicture || "" });
    return this.iqlabs.writer.codeIn({ connection: this.connection, signer: this.keypair }, metadata, "profile.json", 0, "application/json");
  }

  async setRoomMetadata(room: string, meta: { name?: string; description?: string; image?: string }): Promise<string> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required");
    const metaSeed = sha256(`${CHATROOM_PREFIX}${room}_metadata`);
    return this.iqlabs.writer.writeRow(this.connection, this.keypair, this.dbRootId, metaSeed, JSON.stringify(meta));
  }

  // ─── Inscribe ───
  async inscribeData(input: string, filename?: string): Promise<{ txSig: string; isImage: boolean }> {
    if (!this.iqlabs) throw new Error("iqlabs-sdk required for inscription");
    const filePath = resolveFilePath(input);
    let data: string, resolvedName: string, filetype: string;

    if (filePath) {
      const fileData = readFileSync(filePath);
      data = fileData.toString("base64");
      resolvedName = filename || basename(filePath);
      const ext = extname(resolvedName).slice(1).toLowerCase();
      filetype = MIME_TYPES[ext] || "application/octet-stream";
    } else {
      data = input;
      resolvedName = filename || "data.txt";
      filetype = "text/plain";
    }

    const txSig = await this.iqlabs.writer.codeIn(
      { connection: this.connection, signer: this.keypair },
      data, resolvedName, 0, filetype,
    );
    return { txSig, isImage: filePath !== null && filetype.startsWith("image/") };
  }

  // ─── Moltbook ───
  private getMoltbookToken(): string {
    const t = this.settings.moltbookToken;
    if (!t) throw new Error("MOLTBOOK_TOKEN not configured");
    return t;
  }

  async moltbookPost(submolt: string, title: string, content: string): Promise<string> {
    const token = this.getMoltbookToken();
    const res = await fetch(`${URLS.moltbook}/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ submolt, title, content }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || JSON.stringify(d));
    return d.post?.id || "success";
  }

  async moltbookBrowse(submolt?: string, sort = "hot"): Promise<MoltbookPost[]> {
    const url = submolt
      ? `${URLS.moltbook}/submolts/${submolt}/feed?sort=${sort}&limit=10`
      : `${URLS.moltbook}/posts?sort=${sort}&limit=10`;
    const res = await fetch(url);
    const d = await res.json();
    return (d.posts || []) as MoltbookPost[];
  }

  async moltbookComment(postId: string, content: string, parentId?: string): Promise<string> {
    const token = this.getMoltbookToken();
    const body: Record<string, string> = { content };
    if (parentId) body.parent_id = parentId;
    const res = await fetch(`${URLS.moltbook}/posts/${postId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(d));
    return d.id || "success";
  }

  async moltbookReadPost(postId: string): Promise<{ post: MoltbookPost; comments: MoltbookComment[] }> {
    const res = await fetch(`${URLS.moltbook}/posts/${postId}`);
    const d = await res.json();
    if (!d.post) throw new Error("Post not found");
    return { post: d.post as MoltbookPost, comments: (d.comments || []) as MoltbookComment[] };
  }

  // ─── PnL ───
  async tokenLookup(tokenCA: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${URLS.pnl}/tokens/${tokenCA}`);
    if (!res.ok) throw new Error(`Token lookup failed (${res.status})`);
    return (await res.json()) as Record<string, unknown>;
  }

  async pnlCheck(wallet?: string): Promise<Record<string, unknown>> {
    const w = wallet || this.getWalletAddress();
    const res = await fetch(`${URLS.pnl}/pnl/${w}`);
    if (!res.ok) throw new Error(`PnL check failed (${res.status})`);
    return (await res.json()) as Record<string, unknown>;
  }

  async pnlLeaderboard(): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${URLS.pnl}/leaderboard`);
    if (!res.ok) throw new Error(`Leaderboard failed (${res.status})`);
    const d = (await res.json()) as { leaderboard?: Record<string, unknown>[] };
    return d.leaderboard || [];
  }

  // ─── Bags.fm token launch ───
  async bagsLaunchToken(name: string, symbol: string, description: string, imageUrl?: string): Promise<{ tokenMint: string; txSig: string; roomName: string }> {
    const apiKey = this.settings.bagsApiKey;
    if (!apiKey) throw new Error("BAGS_API_KEY not configured");
    const wallet = this.getWalletAddress();
    const roomName = `${name} CTO`;
    const website = `${URLS.base}/chat?room=${encodeURIComponent(roomName)}`;
    const img = imageUrl || `${URLS.base}/iqmolt.png`;

    const fetchBags = async <T>(path: string, body?: Record<string, unknown>): Promise<T> => {
      const res = await fetch(`${BAGS_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`bags.fm ${path} failed (${res.status}): ${await res.text()}`);
      const json = await res.json() as Record<string, unknown>;
      if (json.success === false) throw new Error(`bags.fm ${path}: ${json.response || "unknown"}`);
      return (json.response ?? json) as T;
    };

    const signAndSend = async (encodedTx: string): Promise<string> => {
      const txBytes = bs58.decode(encodedTx);
      const tx = VersionedTransaction.deserialize(txBytes);
      tx.sign([this.keypair]);
      const signed = bs58.encode(tx.serialize());
      const result = await fetchBags<string | { signature?: string; txSignature?: string }>("/solana/send-transaction", { transaction: signed });
      if (typeof result === "string") return result;
      return result.signature || result.txSignature || "unknown";
    };

    // 1. Create token info
    const tokenInfo = await fetchBags<{ tokenMint: string; tokenMetadata: string }>("/token-launch/create-token-info", { name, symbol, description, website, imageUrl: img });
    const tokenMint = tokenInfo.tokenMint;
    if (!tokenMint) throw new Error("bags.fm did not return tokenMint");

    // 2. Fee sharing 50/50
    const feeConfig = await fetchBags<{ meteoraConfigKey?: string; transactions?: Array<string | { transaction: string }> }>("/fee-share/config", {
      payer: wallet, baseMint: tokenMint,
      claimersArray: [IQLABS_FEE_WALLET, wallet], basisPointsArray: [5000, 5000],
    });
    if (feeConfig.transactions) {
      for (const entry of feeConfig.transactions) {
        await signAndSend(typeof entry === "string" ? entry : entry.transaction);
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    // 3. Launch tx (retry 3x)
    const configKey = feeConfig.meteoraConfigKey || "";
    let launchTx = "";
    for (let i = 0; i < 3; i++) {
      try {
        const result = await fetchBags<string | { transaction?: string }>("/token-launch/create-launch-transaction", { wallet, tokenMint, ipfs: tokenInfo.tokenMetadata, configKey });
        launchTx = typeof result === "string" ? result : (result.transaction || "");
        break;
      } catch (err) { if (i < 2) await new Promise(r => setTimeout(r, 5000)); else throw err; }
    }

    // 4. Sign and submit
    const txSig = await signAndSend(launchTx);

    // 5. Create CTO chatroom (non-fatal)
    try { this.allChatrooms.set(roomName, this.buildChatroom(roomName)); } catch { /* ok */ }

    return { tokenMint, txSig, roomName };
  }
}
