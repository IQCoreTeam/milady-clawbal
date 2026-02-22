/**
 * Token actions: bags.fm launch, on-chain data inscription.
 * bags_launch requires BAGS_API_KEY; inscribe requires iqlabs-sdk.
 */
import type { Action, IAgentRuntime } from "@elizaos/core";
import { VersionedTransaction } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { basename, extname, join } from "path";
import { tmpdir } from "os";
import { BAGS_BASE, URLS, IQLABS_FEE_WALLET } from "./config.js";
import { getContext, getAgentName, sha256, buildChatroom } from "./sdk.js";
import { CHATROOM_PREFIX, DB_ROOT_NAME } from "./config.js";

// ─── File / MIME helpers ───

const MIME_TYPES: Record<string, string> = {
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

function resolveFilePath(input: string): string | null {
  let p = input.trim();
  if (p.startsWith("file://")) p = p.slice(7);
  if (p.startsWith("/") && existsSync(p)) return p;
  return null;
}

// ─── Bags.fm helpers ───

async function fetchBags<T>(
  apiKey: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BAGS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`bags.fm ${path} failed (${res.status}): ${text}`);
  }
  const json = await res.json() as Record<string, unknown>;
  if (json.success === false) throw new Error(`bags.fm ${path}: ${json.response || "unknown error"}`);
  return (json.response ?? json) as T;
}

async function signAndSendBags(apiKey: string, encodedTx: string, keypair: Keypair): Promise<string> {
  const txBytes = bs58.decode(encodedTx);
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  const signed = bs58.encode(tx.serialize());
  const result = await fetchBags<string | { signature?: string; txSignature?: string }>(
    apiKey, "/solana/send-transaction", { transaction: signed },
  );
  if (typeof result === "string") return result;
  return result.signature || result.txSignature || "unknown";
}

// ─── BAGS_LAUNCH_TOKEN ───
export const bagsLaunchToken: Action = {
  name: "BAGS_LAUNCH_TOKEN",
  description: "Launch a token on bags.fm with automatic 50/50 fee sharing (IQLabs + agent wallet). Creates a CTO chatroom and registers with PnL tracker.",
  similes: ["LAUNCH_TOKEN", "CREATE_TOKEN", "BAGS_TOKEN"],
  parameters: [
    { name: "name", description: "Token name", required: true, schema: { type: "string" } },
    { name: "symbol", description: "Token ticker symbol", required: true, schema: { type: "string" } },
    { name: "description", description: "Token description", required: true, schema: { type: "string" } },
    { name: "imageUrl", description: "Token image URL (optional)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(launch|create|deploy)\b.*\btoken\b/i.test(text)
      || /\bbags[_ ]?(launch|token)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const apiKey = String(runtime.getSetting("BAGS_API_KEY") || "");
      if (!apiKey) return { success: false, text: "BAGS_API_KEY not configured", error: "missing config" };

      const ctx = await getContext(runtime);
      const wallet = ctx.keypair.publicKey.toBase58();
      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const name = params.name as string;
      const symbol = params.symbol as string;
      const description = params.description as string;
      if (!name || !symbol || !description) return { success: false, text: "name, symbol, and description required", error: "missing params" };

      const roomName = `${name} CTO`;
      const website = `${URLS.base}/chat?room=${encodeURIComponent(roomName)}`;
      const imageUrl = (params.imageUrl as string) || `${URLS.base}/iqmolt.png`;

      // 1. Create token info
      const tokenInfo = await fetchBags<{ tokenMint: string; tokenMetadata: string }>(
        apiKey, "/token-launch/create-token-info",
        { name, symbol, description, website, imageUrl },
      );
      const tokenMint = tokenInfo.tokenMint;
      const ipfs = tokenInfo.tokenMetadata;
      if (!tokenMint) return { success: false, text: "bags.fm did not return a tokenMint", error: "no mint" };

      // 2. Configure fee sharing — 50% IQLabs / 50% agent wallet
      const feeConfig = await fetchBags<{ meteoraConfigKey?: string; transactions?: Array<string | { transaction: string }> }>(
        apiKey, "/fee-share/config",
        { payer: wallet, baseMint: tokenMint, claimersArray: [IQLABS_FEE_WALLET, wallet], basisPointsArray: [5000, 5000] },
      );

      if (feeConfig.transactions && Array.isArray(feeConfig.transactions)) {
        for (const entry of feeConfig.transactions) {
          const txData = typeof entry === "string" ? entry : entry.transaction;
          await signAndSendBags(apiKey, txData, ctx.keypair);
        }
        // Wait for fee txs to confirm
        await new Promise(r => setTimeout(r, 5000));
      }

      // 3. Create and submit launch transaction (retry up to 3 times)
      const configKey = feeConfig.meteoraConfigKey || "";
      let launchTx = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await fetchBags<string | { transaction?: string }>(
            apiKey, "/token-launch/create-launch-transaction",
            { wallet, tokenMint, ipfs, configKey },
          );
          launchTx = typeof result === "string" ? result : (result.transaction || "");
          break;
        } catch (err) {
          if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); }
          else throw err;
        }
      }

      // 4. Sign and submit
      const txSig = await signAndSendBags(apiKey, launchTx, ctx.keypair);

      // 5. Create CTO chatroom on-chain (non-fatal)
      try {
        if (ctx.iqlabs) {
          const dbRootId = sha256(DB_ROOT_NAME);
          const programId = typeof ctx.iqlabs.contract.getProgramId === "function"
            ? ctx.iqlabs.contract.getProgramId()
            : ctx.iqlabs.contract.PROGRAM_ID;
          const dbRootPda = ctx.iqlabs.contract.getDbRootPda(dbRootId, programId);
          const chatroom = buildChatroom(roomName, dbRootId, ctx.iqlabs, dbRootPda, programId);
          ctx.allChatrooms.set(roomName, chatroom);
        }
      } catch { /* non-fatal */ }

      const text = [
        `Token launched!`,
        `Name: ${name} (${symbol})`,
        `Mint: ${tokenMint}`,
        `Tx: ${txSig}`,
        `Room: ${roomName}`,
        `Bags: https://bags.fm/token/${tokenMint}`,
      ].join("\n");

      await callback?.({ text, actions: ["BAGS_LAUNCH_TOKEN"] });
      return { success: true, text, data: { tokenMint, txSig, roomName } };
    } catch (err) {
      const text = `Token launch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "launch a token called 'PEPE' symbol PEPE description 'the frog'" } },
    { name: "{{agent}}", content: { text: "Token launched!\nName: PEPE (PEPE)\nMint: abc...\nTx: xyz...", actions: ["BAGS_LAUNCH_TOKEN"] } },
  ]],
};

// ─── INSCRIBE_DATA ───
export const inscribeData: Action = {
  name: "INSCRIBE_DATA",
  description: "Inscribe data permanently on Solana via IQLabs codeIn. Accepts raw text OR a file path (absolute path or file:// URL) — files are base64-encoded with auto MIME detection. Returns transaction signature and permanent URLs.",
  similes: ["INSCRIBE", "CODEIN", "STORE_ONCHAIN"],
  parameters: [
    { name: "data", description: "Text to inscribe, or an absolute file path (e.g. /tmp/image.png or file:///tmp/image.png)", required: true, schema: { type: "string" } },
    { name: "filename", description: "Display filename (default: auto-detected from path or data.txt)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(inscribe|code[_ ]?in|store[_ ]?on[_ ]?chain)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) return { success: false, text: "iqlabs-sdk not available — cannot inscribe", error: "no sdk" };

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const input = params.data as string;
      if (!input) return { success: false, text: "data required", error: "missing data" };

      const filePath = resolveFilePath(input);

      let data: string;
      let resolvedName: string;
      let filetype: string;

      if (filePath) {
        const fileData = readFileSync(filePath);
        data = fileData.toString("base64");
        resolvedName = (params.filename as string) || basename(filePath);
        const ext = extname(resolvedName).slice(1).toLowerCase();
        filetype = MIME_TYPES[ext] || "application/octet-stream";
      } else {
        data = input;
        resolvedName = (params.filename as string) || "data.txt";
        filetype = "text/plain";
      }

      const txSig = await ctx.iqlabs.writer.codeIn(
        { connection: ctx.connection, signer: ctx.keypair },
        data, resolvedName, 0, filetype,
      );

      const gw = URLS.gateway;
      const isImage = filePath !== null && filetype.startsWith("image/");
      const viewUrl = isImage ? `${gw}/img/${txSig}` : `${gw}/view/${txSig}`;
      const text = `Inscribed on-chain.\nTx: ${txSig}\nURL: ${viewUrl}\nRender: ${gw}/render/${txSig}`;
      await callback?.({ text, actions: ["INSCRIBE_DATA"] });
      return { success: true, text, data: { txSig, isImage } };
    } catch (err) {
      const text = `Inscribe failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "inscribe 'gm from clawbal' on chain" } },
    { name: "{{agent}}", content: { text: "Inscribed on-chain.\nTx: abc123...\nURL: https://gateway.iqlabs.dev/view/abc123", actions: ["INSCRIBE_DATA"] } },
  ]],
};

// ─── Image generation (5 providers) ───

async function generateImageFile(apiKey: string, prompt: string): Promise<string> {
  const outPath = join(tmpdir(), `clawbal-img-${Date.now()}.webp`);
  const TIMEOUT_MS = 60_000;
  const MAX_POLLS = 60;

  if (apiKey.startsWith("fw_")) {
    // Fireworks AI — async workflow (FLUX Kontext Max)
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const model = "flux-kontext-max";
    const base = `https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/${model}`;
    try {
      const createRes = await fetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });
      if (!createRes.ok) throw new Error(`Fireworks create failed (${createRes.status}): ${await createRes.text()}`);
      const { request_id } = (await createRes.json()) as { request_id: string };
      if (!request_id) throw new Error("Fireworks returned no request_id");

      let polls = 0;
      while (true) {
        if (++polls > MAX_POLLS) throw new Error("Fireworks image timed out (max polls)");
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`${base}/get_result`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: request_id }),
          signal: ac.signal,
        });
        if (!pollRes.ok) throw new Error(`Fireworks poll failed (${pollRes.status})`);
        const result = (await pollRes.json()) as { status: string; result?: { sample?: string } };

        if (result.status === "Ready") {
          const imageUrl = result.result?.sample;
          if (!imageUrl) throw new Error("Fireworks returned Ready but no image URL");
          const imgRes = await fetch(imageUrl, { signal: ac.signal });
          if (!imgRes.ok) throw new Error(`Failed to download image from Fireworks (${imgRes.status})`);
          writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
          break;
        } else if (result.status === "Error" || result.status === "Content Moderated" || result.status === "Request Moderated") {
          throw new Error(`Fireworks image failed: ${result.status}`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } else if (apiKey.startsWith("sk-or")) {
    // OpenRouter — chat completions with modalities: ["image"]
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "black-forest-labs/flux.2-klein",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image"],
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string; images?: string[] } }[];
      };
      const imageUrl = data.choices?.[0]?.message?.images?.[0];
      if (!imageUrl) throw new Error("OpenRouter returned no image");

      const base64Match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (base64Match) {
        writeFileSync(outPath, Buffer.from(base64Match[1], "base64"));
      } else {
        const imgRes = await fetch(imageUrl, { signal: ac.signal });
        if (!imgRes.ok) throw new Error(`Failed to download image from OpenRouter`);
        writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
      }
    } finally {
      clearTimeout(timer);
    }
  } else if (apiKey.startsWith("r8_")) {
    // Replicate — async polling
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const createRes = await fetch(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: { prompt } }),
          signal: ac.signal,
        },
      );
      if (!createRes.ok) throw new Error(`Replicate create failed (${createRes.status}): ${await createRes.text()}`);
      let prediction = (await createRes.json()) as { id: string; status: string; output?: string[] };

      let polls = 0;
      while (prediction.status !== "succeeded" && prediction.status !== "failed") {
        if (++polls > MAX_POLLS) throw new Error("Replicate prediction timed out (max polls)");
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: ac.signal,
        });
        if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
        prediction = (await pollRes.json()) as typeof prediction;
      }
      if (prediction.status === "failed" || !prediction.output?.[0]) {
        throw new Error("Replicate prediction failed");
      }

      const imgRes = await fetch(prediction.output[0], { signal: ac.signal });
      if (!imgRes.ok) throw new Error(`Failed to download image from Replicate`);
      writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
  } else if (apiKey.startsWith("key-")) {
    // Fal.ai — synchronous
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Fal.ai failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { images: { url: string }[] };
      if (!data.images?.[0]?.url) throw new Error("Fal.ai returned no image");

      const imgRes = await fetch(data.images[0].url, { signal: ac.signal });
      if (!imgRes.ok) throw new Error(`Failed to download image from Fal.ai`);
      writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
  } else {
    // Together AI — synchronous, base64 response
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "black-forest-labs/FLUX.1-schnell",
          prompt,
          steps: 4,
          response_format: "b64_json",
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Together AI failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { data: { b64_json: string }[] };
      if (!data.data?.[0]?.b64_json) throw new Error("Together AI returned no image");

      writeFileSync(outPath, Buffer.from(data.data[0].b64_json, "base64"));
    } finally {
      clearTimeout(timer);
    }
  }

  return outPath;
}

// ─── GENERATE_IMAGE ───
export const generateImage: Action = {
  name: "GENERATE_IMAGE",
  description: "Generate an AI image and automatically inscribe it on-chain. Returns the permanent on-chain URL ready to use in messages, profiles, or token launches. Supports 5 providers (auto-detected from API key).",
  similes: ["CREATE_IMAGE", "MAKE_IMAGE", "AI_IMAGE"],
  parameters: [
    { name: "prompt", description: "Image description / prompt for the AI model", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime, message) => {
    const apiKey = String(runtime.getSetting("IMAGE_API_KEY") || "");
    if (!apiKey) return false;
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(generate|create|make|draw)\b.*\b(image|picture|art|photo|pic)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const apiKey = String(runtime.getSetting("IMAGE_API_KEY") || "");
      if (!apiKey) return { success: false, text: "IMAGE_API_KEY not configured", error: "missing config" };

      const ctx = await getContext(runtime);
      if (!ctx.iqlabs) return { success: false, text: "iqlabs-sdk not available — cannot inscribe image", error: "no sdk" };

      const params = (options?.parameters ?? {}) as Record<string, unknown>;
      const prompt = params.prompt as string;
      if (!prompt) return { success: false, text: "prompt required", error: "missing prompt" };

      // Generate image to temp file
      const filePath = await generateImageFile(apiKey, prompt);

      // Inscribe the generated image on-chain
      const fileData = readFileSync(filePath);
      const data = fileData.toString("base64");
      const resolvedName = basename(filePath);
      const ext = extname(resolvedName).slice(1).toLowerCase();
      const filetype = MIME_TYPES[ext] || "image/webp";

      const txSig = await ctx.iqlabs.writer.codeIn(
        { connection: ctx.connection, signer: ctx.keypair },
        data, resolvedName, 0, filetype,
      );

      const gw = URLS.gateway;
      const url = `${gw}/img/${txSig}`;
      const text = `Image generated and inscribed on-chain.\nTx: ${txSig}\nURL: ${url}`;
      await callback?.({ text, actions: ["GENERATE_IMAGE"] });
      return { success: true, text, data: { txSig, url } };
    } catch (err) {
      const text = `Image generation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "generate an image of a cyberpunk cat" } },
    { name: "{{agent}}", content: { text: "Image generated and inscribed on-chain.\nTx: abc123...\nURL: https://gateway.iqlabs.dev/img/abc123", actions: ["GENERATE_IMAGE"] } },
  ]],
};
