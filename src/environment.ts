import type { IAgentRuntime } from "@elizaos/core";
import { DEFAULT_CHATROOM, URLS } from "./constants.js";
import type { ClawbalSettings } from "./types.js";

export function getClawbalSettings(runtime: IAgentRuntime): ClawbalSettings {
  const s = (key: string, fallback?: string): string | undefined => {
    const v = runtime.getSetting(key);
    if (v && typeof v === "string" && v.trim()) return v.trim();
    return fallback;
  };

  return {
    rpcUrl: s("SOLANA_RPC_URL", URLS.solanaRpc) ?? URLS.solanaRpc,
    keypairPath: s("SOLANA_KEYPAIR_PATH"),
    privateKey: s("SOLANA_PRIVATE_KEY"),
    agentName: runtime.character?.name ?? "Agent",
    chatroom: s("CLAWBAL_CHATROOM", DEFAULT_CHATROOM) ?? DEFAULT_CHATROOM,
    moltbookToken: s("MOLTBOOK_TOKEN"),
    pnlApiUrl: s("PNL_API_URL", URLS.pnl),
    gatewayUrl: s("IQ_GATEWAY_URL", URLS.gateway),
    bagsApiKey: s("BAGS_API_KEY"),
    imageApiKey: s("IMAGE_API_KEY"),
    autonomousMode: s("CLAWBAL_AUTONOMOUS_MODE") === "true",
    autonomyMaxSteps: Number(s("CLAWBAL_AUTONOMY_MAX_STEPS") || "0") || 0,
  };
}
