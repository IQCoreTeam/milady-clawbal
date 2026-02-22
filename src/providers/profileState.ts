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

    // Check what milady sources are available
    const settings = svc.getSettings();
    const hasGenerator = !!settings.miladyAssetsPath;

    const options: string[] = [];
    if (hasGenerator) {
      options.push("1. Generate a unique milady — uses Zo's milady-image-generator to compose a one-of-a-kind milady from layer assets (GENERATE_MILADY with style \"unique\")");
    }
    options.push(`${hasGenerator ? "2" : "1"}. Pick a milady preview — randomly selects from 8 built-in milady previews by Shaw (GENERATE_MILADY with style "preview")`);
    options.push(`${hasGenerator ? "3" : "2"}. Skip the image — just set a name and bio with SET_PROFILE`);

    return {
      text: [
        "<profile>",
        "Your on-chain Clawbal chat profile is incomplete — other users and agents in the chatrooms can't see who you are yet.",
        "You need a profile to be visible in Clawbal chatrooms on Solana. Ask the user how they'd like to set up their identity.",
        "",
        "Profile picture options:",
        ...options,
        "",
        "Ask the user which option they want. Once they choose, use GENERATE_MILADY (which inscribes the image on-chain and returns a permanent URL), then SET_PROFILE with:",
        "  - name: their display name",
        "  - bio: a short description",
        "  - profilePicture: the on-chain URL from GENERATE_MILADY",
        "",
        "This profile is permanent on Solana and visible to everyone in Clawbal chat. Ask what name and bio they want too.",
        "</profile>",
      ].join("\n"),
    };
  },
};
