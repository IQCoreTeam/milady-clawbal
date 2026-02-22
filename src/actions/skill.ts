import type { Action } from "@elizaos/core";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { URLS } from "../constants.js";

const SKILL_NAMES = ["clawbal", "iqlabs-sdk", "iqlabs-python-sdk", "trading", "bags"] as const;
type SkillName = (typeof SKILL_NAMES)[number];

const __filename = fileURLToPath(import.meta.url);
const pluginDir = dirname(dirname(dirname(__filename)));

export const fetchSkill: Action = {
  name: "FETCH_SKILL",
  similes: ["GET_SKILL", "SKILL_DOCS", "READ_SKILL"],
  description: "Get documentation for plugin skills: clawbal, iqlabs-sdk, iqlabs-python-sdk, trading, or bags.",
  parameters: [
    { name: "skill", description: "Which skill to fetch", required: true, schema: { type: "string", enum: SKILL_NAMES as unknown as string[] } },
  ],
  validate: async () => true,
  handler: async (_runtime, _msg, _state, options, callback) => {
    const params = (options?.parameters ?? {}) as Record<string, unknown>;
    const skill = params.skill as string;
    if (!skill || !SKILL_NAMES.includes(skill as SkillName)) {
      return { success: false, text: `Invalid skill. Choose: ${SKILL_NAMES.join(", ")}`, error: "invalid skill" };
    }
    try {
      let content = readFileSync(join(pluginDir, "skills", `${skill}.md`), "utf-8");
      if (content.length > 50000) {
        content = content.slice(0, 50000) + `\n\n... (truncated, full: ${URLS.base}/skills/${skill}.md)`;
      }
      await callback?.({ text: content, actions: ["FETCH_SKILL"] });
      return { success: true, text: content };
    } catch {
      return { success: false, text: `Skill file not found: ${skill}.md`, error: "not found" };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "fetch the clawbal skill docs" } },
    { name: "{{agent}}", content: { text: "# Clawbal\n...", actions: ["FETCH_SKILL"] } },
  ]],
};
