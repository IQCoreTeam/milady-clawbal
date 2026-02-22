import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME, URLS } from "../constants.js";
import type { ClawbalService } from "../service.js";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const generateMilady: Action = {
  name: "GENERATE_MILADY",
  description: "Generate a milady profile picture. Pass style: \"unique\" for Zo's milady-image-generator (requires MILADY_ASSETS_PATH + sharp) or style: \"preview\" for one of Shaw's 8 built-in milady previews. The image is inscribed on-chain and returns a permanent gateway.iqlabs.dev/img/{txSig} URL — use it with SET_PROFILE as your profilePicture.",
  similes: ["CREATE_MILADY", "MILADY_PFP", "MAKE_MILADY"],
  examples: [],
  validate: async (runtime: IAgentRuntime) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime: IAgentRuntime, _msg: Memory, _state: State | undefined, options: Record<string, unknown> | undefined, callback?: HandlerCallback) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const settings = svc.getSettings();
    const style = String(options?.style || "").toLowerCase();
    let pfpPath = "";
    let method = "";

    if (style !== "preview") {
      const assetsPath = settings.miladyAssetsPath;
      if (assetsPath) {
        try {
          const { canGenerateMilady, generateMiladyPFP } = await import("../milady-gen.js");
          if (await canGenerateMilady(assetsPath)) {
            pfpPath = await generateMiladyPFP(assetsPath);
            method = "generated unique milady from layer assets";
          }
        } catch { /* sharp not available, fall through */ }
      }
      if (!pfpPath && style === "unique") {
        const text = "Unique generation not available. Set MILADY_ASSETS_PATH and install sharp, or try style: \"preview\".";
        callback?.({ text });
        return { success: false, text };
      }
    }

    if (!pfpPath) {
      const pluginDir = dirname(fileURLToPath(import.meta.url));
      const pfpDir = join(pluginDir, "..", "..", "pfp");
      if (existsSync(pfpDir)) {
        const pfps = readdirSync(pfpDir).filter(f => f.endsWith(".png"));
        if (pfps.length > 0) {
          const pick = pfps[Math.floor(Math.random() * pfps.length)];
          pfpPath = join(pfpDir, pick);
          method = `picked ${pick} from built-in milady previews`;
        }
      }
    }

    if (!pfpPath || !existsSync(pfpPath)) {
      const text = "No milady assets found. Set MILADY_ASSETS_PATH for unique generation or ensure the pfp/ directory exists.";
      callback?.({ text });
      return { success: false, text };
    }

    try {
      const result = await svc.inscribeData(pfpPath, "milady-pfp.png");
      const url = `${URLS.gateway}/${result.isImage ? "img" : "view"}/${result.txSig}`;
      const text = `Milady PFP ready! ${method}\n\nOn-chain URL: ${url}\n\nUse SET_PROFILE with this URL as your profilePicture.`;
      callback?.({ text });
      return { success: true, text };
    } catch (err) {
      const text = `Milady generated but inscription failed: ${err instanceof Error ? err.message : String(err)}`;
      callback?.({ text });
      return { success: false, text };
    }
  },
};
