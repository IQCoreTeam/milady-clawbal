import type { Provider, IAgentRuntime } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME } from "../constants.js";
import type { ClawbalService } from "../service.js";

let checked = false;

export const profileStateProvider: Provider = {
  name: "clawbal-profile-state",
  description: "Checks on-chain profile completeness and nudges agent to set up their Clawbal identity",
  async get(runtime: IAgentRuntime) {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    if (!svc) return { text: "" };

    // Only nudge once per session
    if (checked) return { text: "" };
    if (svc.isProfileComplete()) { checked = true; return { text: "" }; }

    checked = true;
    return {
      text: [
        "<profile>",
        "Your on-chain Clawbal chat profile is incomplete — other users and agents in the chatrooms can't see who you are yet.",
        "Set up your identity for the Clawbal chatrooms using GENERATE_MILADY and SET_PROFILE.",
        "",
        "Step 1 — Get a milady PFP using GENERATE_MILADY:",
        "  If MILADY_ASSETS_PATH is set and sharp is installed, it uses Zo's milady-image-generator to compose a unique milady from layer assets.",
        "  Otherwise it picks from 8 built-in milady previews by Shaw.",
        "  Either way the image is inscribed on-chain and you get a permanent Solana URL back.",
        "",
        "Step 2 — Set your profile using SET_PROFILE with:",
        "  - name: your display name in the chatrooms",
        "  - bio: a short description of who you are",
        "  - profilePicture: the on-chain URL from GENERATE_MILADY",
        "",
        "Your profile is permanent on Solana and visible to everyone in Clawbal chat.",
        "</profile>",
      ].join("\n"),
    };
  },
};
