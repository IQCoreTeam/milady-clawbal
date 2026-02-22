/**
 * Skill actions: fetch plugin skill documentation.
 */
import type { Action } from "@elizaos/core";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SKILL_NAMES = ["clawbal", "iqlabs-sdk", "iqlabs-python-sdk", "trading", "bags"] as const;
type SkillName = (typeof SKILL_NAMES)[number];

// Resolve plugin root (parent of src/)
const __filename = fileURLToPath(import.meta.url);
const pluginDir = dirname(dirname(__filename));

// ─── FETCH_SKILL ───
export const fetchSkill: Action = {
  name: "FETCH_SKILL",
  description: "Get documentation for plugin skills. Returns the skill markdown content for clawbal, iqlabs-sdk, iqlabs-python-sdk, trading, or bags.",
  similes: ["GET_SKILL", "SKILL_DOCS", "READ_SKILL"],
  parameters: [
    {
      name: "skill",
      description: "Which skill to fetch: clawbal, iqlabs-sdk, iqlabs-python-sdk, trading, or bags",
      required: true,
      schema: { type: "string", enum: SKILL_NAMES as unknown as string[] },
    },
  ],
  validate: async (_runtime, message) => {
    const text = message?.content?.text?.toLowerCase() ?? "";
    return /\b(fetch|get|read|show)\b.*\b(skill|docs?|documentation)\b/i.test(text)
      || /\bskill\b/i.test(text);
  },
  handler: async (_runtime, _message, _state, options, callback) => {
    try {
      const params = options?.parameters ?? {};
      const skill = params.skill as string;
      if (!skill || !SKILL_NAMES.includes(skill as SkillName)) {
        return { success: false, text: `Invalid skill. Choose one of: ${SKILL_NAMES.join(", ")}`, error: "invalid skill" };
      }

      const maxLen = 50000;
      const skillFile = join(pluginDir, "skills", `${skill}.md`);
      let content: string;
      try {
        content = readFileSync(skillFile, "utf-8");
      } catch {
        return { success: false, text: `Skill file not found: ${skill}.md`, error: "not found" };
      }

      if (content.length > maxLen) {
        content = content.slice(0, maxLen) + `\n\n... (truncated, full docs: https://ai.iqlabs.dev/skills/${skill}.md)`;
      }

      await callback?.({ text: content, actions: ["FETCH_SKILL"] });
      return { success: true, text: content };
    } catch (err) {
      const text = `Fetch skill failed: ${err instanceof Error ? err.message : String(err)}`;
      return { success: false, text, error: text };
    }
  },
  examples: [[
    { name: "{{user}}", content: { text: "fetch the clawbal skill docs" } },
    { name: "{{agent}}", content: { text: "# Clawbal Skill\n...", actions: ["FETCH_SKILL"] } },
  ]],
};
