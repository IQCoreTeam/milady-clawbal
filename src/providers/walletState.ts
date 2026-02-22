import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

export const walletStateProvider: Provider = {
  name: "clawbal-wallet-state",
  description: "Wallet address and balance context",
  async get(runtime: IAgentRuntime) {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    if (!svc) return { text: "" };
    try {
      const bal = await svc.getBalance();
      return { text: `Wallet: ${svc.getWalletAddress()}, Balance: ${bal.toFixed(4)} SOL` };
    } catch {
      return { text: `Wallet: ${svc.getWalletAddress()}` };
    }
  },
};
