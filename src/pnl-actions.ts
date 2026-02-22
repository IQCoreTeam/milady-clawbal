/**
 * PnL actions: token lookup, PnL check, leaderboard.
 * All HTTP-only — no SDK required.
 */
import type { Action } from "@elizaos/core";
import { URLS } from "./config.js";
import { getContext } from "./sdk.js";
import type { PnlTokenInfo, PnlUserCallsResponse, PnlLeaderboardEntry } from "./types.js";

async function fetchPnl<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${URLS.pnl}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`PNL ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

function fmtPnl(pct: number | undefined | null): string {
  if (pct == null) return "N/A";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtMcap(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── TOKEN_LOOKUP ───
export const tokenLookup: Action = {
  name: "TOKEN_LOOKUP",
  description: "Look up a Solana token by contract address. Returns price, market cap, liquidity, volume, and price changes.",
  similes: ["CHECK_TOKEN", "TOKEN_INFO", "TOKEN_PRICE", "LOOKUP_CA"],
  parameters: [
    {
      name: "tokenCA",
      description: "Token contract address (Solana base58)",
      required: true,
      schema: { type: "string" },
    },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(token|ca|contract|price|mcap|lookup|check)\b/i.test(text)
      && /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(message?.content?.text ?? "");
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const params = options?.parameters ?? {};
      let tokenCA = params.tokenCA as string;

      // Also try to extract CA from the raw message if not in params
      if (!tokenCA) {
        const match = (message?.content?.text ?? "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
        tokenCA = match?.[0] ?? "";
      }
      if (!tokenCA) return { success: false, text: "No token contract address provided", error: "missing tokenCA" };

      const info = await fetchPnl<PnlTokenInfo>(`/mcap/${tokenCA}`);

      const text = [
        `${info.name} (${info.symbol})`,
        `Price: $${info.price?.toFixed(8) ?? "N/A"}`,
        `Mcap: ${fmtMcap(info.mcap)}`,
        `Liquidity: ${fmtMcap(info.liquidity)}`,
        `24h Volume: ${fmtMcap(info.volume24h)}`,
        `1h: ${fmtPnl(info.priceChange1h)} | 24h: ${fmtPnl(info.priceChange24h)}`,
        `Buys/Sells (1h): ${info.buys1h ?? 0}/${info.sells1h ?? 0}`,
        `DEX: ${info.dex || "unknown"}`,
      ].join("\n");

      await callback?.({ text, actions: ["TOKEN_LOOKUP"] });
      return { success: true, text, data: info };
    } catch (err) {
      const text = `Token lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "check token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } },
    { name: "{{agent}}", content: { text: "USDC (USDC)\nPrice: $1.00\nMcap: $35.2B...", actions: ["TOKEN_LOOKUP"] } },
  ]],
};

// ─── PNL_CHECK ───
export const pnlCheck: Action = {
  name: "PNL_CHECK",
  description: "Check PnL (profit/loss) for token calls made by a wallet. Shows hit rate, average return, and top calls.",
  similes: ["CHECK_PNL", "MY_PNL", "WALLET_PNL", "PERFORMANCE"],
  parameters: [
    {
      name: "wallet",
      description: "Wallet address to check PnL for (omit for agent's own wallet)",
      required: false,
      schema: { type: "string" },
    },
  ],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(pnl|profit|loss|performance|calls|hit rate)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const ctx = await getContext(runtime);
      const params = options?.parameters ?? {};
      const wallet = (params.wallet as string) || ctx.keypair.publicKey.toBase58();

      const data = await fetchPnl<PnlUserCallsResponse>(`/users/${wallet}/calls`);
      const { stats, calls } = data;

      const lines = [
        `PnL for ${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
        `Total calls: ${stats.totalCalls}`,
        `Hit rate: ${stats.hitRate?.toFixed(1) ?? 0}%`,
        `Avg return: ${fmtPnl(stats.avgReturn)}`,
        `Median return: ${fmtPnl(stats.medReturn)}`,
      ];

      if (calls.length > 0) {
        lines.push("\nTop calls:");
        const top = calls.sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0)).slice(0, 5);
        for (const c of top) {
          lines.push(`  ${c.tokenCA.slice(0, 8)}... ${fmtPnl(c.pnlPercent)} (entry mcap: ${fmtMcap(c.firstCallMcap)})`);
        }
      }

      const text = lines.join("\n");
      await callback?.({ text, actions: ["PNL_CHECK"] });
      return { success: true, text, data };
    } catch (err) {
      const text = `PnL check failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "check my pnl" } },
    { name: "{{agent}}", content: { text: "PnL for 4Kcv...guS5\nTotal calls: 12\nHit rate: 66.7%...", actions: ["PNL_CHECK"] } },
  ]],
};

// ─── PNL_LEADERBOARD ───
export const pnlLeaderboard: Action = {
  name: "PNL_LEADERBOARD",
  description: "View the top token calls ranked by PnL performance on the Clawbal leaderboard.",
  similes: ["LEADERBOARD", "TOP_CALLS", "RANKINGS"],
  parameters: [],
  validate: async (runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(leaderboard|ranking|top calls|best calls|top traders)\b/i.test(text);
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const entries = await fetchPnl<PnlLeaderboardEntry[]>("/leaderboard");

      if (entries.length === 0) {
        const text = "Leaderboard is empty.";
        await callback?.({ text, actions: ["PNL_LEADERBOARD"] });
        return { success: true, text };
      }

      const lines = ["Clawbal PnL Leaderboard:"];
      const top = entries.slice(0, 10);
      for (let i = 0; i < top.length; i++) {
        const e = top[i];
        lines.push(`${i + 1}. ${e.userWallet.slice(0, 6)}... | ${e.tokenCA.slice(0, 8)}... | ${fmtPnl(e.pnlPercent)} | Entry: ${fmtMcap(e.entryMcap)}`);
      }

      const text = lines.join("\n");
      await callback?.({ text, actions: ["PNL_LEADERBOARD"] });
      return { success: true, text, data: { entries: top } };
    } catch (err) {
      const text = `Leaderboard failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "show the pnl leaderboard" } },
    { name: "{{agent}}", content: { text: "Clawbal PnL Leaderboard:\n1. 4Kcv... | EPjF... | +523.4%...", actions: ["PNL_LEADERBOARD"] } },
  ]],
};
