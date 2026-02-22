import type { Action } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const tokenLookup: Action = {
  name: "TOKEN_LOOKUP",
  similes: ["CHECK_TOKEN", "TOKEN_INFO", "TOKEN_PRICE"],
  description: "Look up token info by contract address — price, mcap, volume, liquidity.",
  parameters: [
    { name: "tokenCA", description: "Token contract address (Solana mint)", required: true, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    let tokenCA = params.tokenCA as string;
    if (!tokenCA) {
      const match = (_msg?.content?.text || "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      tokenCA = match?.[0] ?? "";
    }
    if (!tokenCA) return { success: false, text: "No token contract address provided", error: "missing tokenCA" };
    try {
      const info = await svc.tokenLookup(tokenCA);
      const text = JSON.stringify(info, null, 2);
      await callback?.({ text, actions: ["TOKEN_LOOKUP"] });
      return { success: true, text, data: info };
    } catch (err) {
      const text = `Token lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "check token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } },
    { name: "{{agent}}", content: { text: "{\"name\": \"USDC\", ...}", actions: ["TOKEN_LOOKUP"] } },
  ]],
};

export const pnlCheck: Action = {
  name: "PNL_CHECK",
  similes: ["CHECK_PNL", "MY_PNL", "PROFIT_LOSS"],
  description: "Check PnL (profit and loss) for a wallet's token calls.",
  parameters: [
    { name: "wallet", description: "Wallet address (default: agent wallet)", required: false, schema: { type: "string" } },
  ],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    try {
      const data = await svc.pnlCheck(params.wallet as string);
      const text = JSON.stringify(data, null, 2);
      await callback?.({ text, actions: ["PNL_CHECK"] });
      return { success: true, text, data };
    } catch (err) {
      const text = `PnL check failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "check my pnl" } },
    { name: "{{agent}}", content: { text: "{\"calls\": [...], \"stats\": {...}}", actions: ["PNL_CHECK"] } },
  ]],
};

export const pnlLeaderboard: Action = {
  name: "PNL_LEADERBOARD",
  similes: ["LEADERBOARD", "TOP_TRADERS", "PNL_RANKINGS"],
  description: "View the PnL leaderboard — top performing token calls.",
  parameters: [],
  validate: async (runtime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime, _msg, _state, _options, callback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    try {
      const entries = await svc.pnlLeaderboard();
      const text = entries.length
        ? entries.map((e, i) => `${i + 1}. ${String(e.userWallet).slice(0, 6)}... | ${String(e.tokenCA).slice(0, 8)}... | ${e.pnlPercent}%`).join("\n")
        : "No leaderboard data";
      await callback?.({ text, actions: ["PNL_LEADERBOARD"] });
      return { success: true, text, data: { entries } };
    } catch (err) {
      const text = `Leaderboard failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "show pnl leaderboard" } },
    { name: "{{agent}}", content: { text: "1. abc... | def... | 250%", actions: ["PNL_LEADERBOARD"] } },
  ]],
};
