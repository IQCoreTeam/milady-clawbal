import type { Action } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME, URLS } from "../constants.js";
import type { ClawbalService } from "../service.js";
import { generateImage } from "../image-gen.js";

export const inscribeData: Action = {
  name: "INSCRIBE_DATA",
  similes: ["INSCRIBE", "CODEIN", "STORE_ONCHAIN"],
  description: "Inscribe data permanently on Solana. Accepts raw text or a file path (absolute or file:// URL) — files are base64-encoded with auto MIME detection.",
  parameters: [
    { name: "data", description: "Text to inscribe, or absolute file path", required: true, schema: { type: "string" } },
    { name: "filename", description: "Display filename (auto-detected from path or data.txt)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const input = params.data as string;
    if (!input) return { success: false, text: "data required", error: "missing data" };
    try {
      const { txSig, isImage } = await svc.inscribeData(input, params.filename as string);
      const gw = URLS.gateway;
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
    { name: "{{agent}}", content: { text: "Inscribed on-chain.\nTx: abc...\nURL: https://gateway.iqlabs.dev/view/abc", actions: ["INSCRIBE_DATA"] } },
  ]],
};

export const bagsLaunchToken: Action = {
  name: "BAGS_LAUNCH_TOKEN",
  similes: ["LAUNCH_TOKEN", "CREATE_TOKEN"],
  description: "Launch a token on bags.fm with 50/50 fee sharing. Creates a CTO chatroom.",
  parameters: [
    { name: "name", description: "Token name", required: true, schema: { type: "string" } },
    { name: "symbol", description: "Token ticker symbol", required: true, schema: { type: "string" } },
    { name: "description", description: "Token description", required: true, schema: { type: "string" } },
    { name: "imageUrl", description: "Token image URL (optional)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    return !!svc?.getSettings().bagsApiKey;
  },
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const name = params.name as string;
    const symbol = params.symbol as string;
    const description = params.description as string;
    if (!name || !symbol || !description) return { success: false, text: "name, symbol, and description required", error: "missing params" };
    try {
      const { tokenMint, txSig, roomName } = await svc.bagsLaunchToken(name, symbol, description, params.imageUrl as string);
      const text = `Token launched!\nName: ${name} (${symbol})\nMint: ${tokenMint}\nTx: ${txSig}\nRoom: ${roomName}\nBags: https://bags.fm/token/${tokenMint}`;
      await callback?.({ text, actions: ["BAGS_LAUNCH_TOKEN"] });
      return { success: true, text, data: { tokenMint, txSig, roomName } };
    } catch (err) {
      const text = `Token launch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "launch a token called PEPE symbol PEPE description 'the frog'" } },
    { name: "{{agent}}", content: { text: "Token launched!\nName: PEPE (PEPE)\nMint: abc...", actions: ["BAGS_LAUNCH_TOKEN"] } },
  ]],
};

export const generateImageAction: Action = {
  name: "GENERATE_IMAGE",
  similes: ["CREATE_IMAGE", "MAKE_IMAGE", "AI_IMAGE"],
  description: "Generate an AI image and inscribe it on-chain. Returns permanent URL.",
  parameters: [
    { name: "prompt", description: "Image description / prompt", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    return !!svc?.getSettings().imageApiKey;
  },
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const prompt = params.prompt as string;
    if (!prompt) return { success: false, text: "prompt required", error: "missing prompt" };
    const apiKey = svc.getSettings().imageApiKey!;
    try {
      const filePath = await generateImage(apiKey, prompt);
      const { txSig } = await svc.inscribeData(filePath);
      const url = `${URLS.gateway}/img/${txSig}`;
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
    { name: "{{agent}}", content: { text: "Image generated and inscribed.\nURL: https://gateway.iqlabs.dev/img/abc...", actions: ["GENERATE_IMAGE"] } },
  ]],
};
