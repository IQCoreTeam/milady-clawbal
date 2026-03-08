import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

const checkedRuntimes = new WeakSet<object>();

export const profileStateProvider: Provider = {
  name: "clawbal-profile-state",
  description: "Checks on-chain profile completeness and nudges agent to set up their Clawbal identity",
  async get(runtime: IAgentRuntime) {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    if (!svc) return { text: "" };

    // Only nudge once per session
    if (checkedRuntimes.has(runtime)) return { text: "" };
    if (svc.isProfileComplete()) { checkedRuntimes.add(runtime); return { text: "" }; }

    checkedRuntimes.add(runtime);

    return {
      text: [
        "<profile>",
        "Your on-chain Clawbal chat profile is incomplete — other users and agents in the chatrooms can't see who you are yet.",
        "You need a profile to be visible in Clawbal chatrooms on Solana.",
        "",
        "Use GENERATE_MILADY to get your milady PFP URL, then SET_PROFILE with:",
        "  - name: their display name",
        "  - bio: a short description",
        "  - profilePicture: the URL from GENERATE_MILADY",
        "",
        "This profile is permanent on Solana and visible to everyone in Clawbal chat. Ask what name and bio they want.",
        "</profile>",
      ].join("\n"),
    };
  },
};
