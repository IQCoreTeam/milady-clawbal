import type { Action } from "@elizaos/core";
import { CLAWBAL_SERVICE_NAME, URLS } from "../constants.js";
import type { ClawbalService } from "../service.js";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const generateMilady: Action = {
  name: "GENERATE_MILADY",
  description: "Generate a milady profile picture. Pass style: \"unique\" for Zo's milady-image-generator (requires MILADY_ASSETS_PATH + sharp) or style: \"preview\" for one of Shaw's 8 built-in milady previews. The image is inscribed on-chain and returns a permanent Solana URL for SET_PROFILE.",
  similes: ["CREATE_MILADY", "MILADY_PFP", "MAKE_MILADY"],
  examples: [],
  validate: async (runtime: any) => !!runtime.getService(CLAWBAL_SERVICE_NAME),
  handler: async (runtime: any, _msg: any, _state: any, options: any, callback: any) => {
    const svc = runtime.getService(CLAWBAL_SERVICE_NAME) as ClawbalService;
    const settings = svc.getSettings();
    const style = (options?.style || "").toLowerCase();
    let pfpPath = "";
    let method = "";

    // "unique" — Zo's milady-image-generator from layer assets
    if (style !== "preview") {
      const assetsPath = settings.miladyAssetsPath;
      if (assetsPath) {
        try {
          const { canGenerateMilady, generateMiladyPFP } = await import("../milady-gen.js");
          if (await canGenerateMilady(assetsPath)) {
            pfpPath = await generateMiladyPFP(assetsPath);
            method = "generated unique milady from layer assets";
          }
        } catch { /* fall through */ }
      }
      if (!pfpPath && style === "unique") {
        callback({ text: "Unique generation not available. Set MILADY_ASSETS_PATH and install sharp, or try style: \"preview\"." });
        return;
      }
    }

    // "preview" — Shaw's built-in milady previews
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
      callback({ text: "No milady assets found. Set MILADY_ASSETS_PATH for unique generation or ensure the pfp/ directory exists." });
      return;
    }

    // Inscribe on-chain
    try {
      const result = await svc.inscribeData(pfpPath, "milady-pfp.png");
      const url = `${URLS.gateway}/${result.isImage ? "img" : "view"}/${result.txSig}`;
      callback({ text: `Milady PFP ready! ${method}\n\nOn-chain URL: ${url}\n\nUse SET_PROFILE with this URL as your profilePicture.` });
    } catch (err) {
      callback({ text: `Milady generated but inscription failed: ${err}` });
    }
  },
};
