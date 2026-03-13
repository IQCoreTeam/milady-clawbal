import type { Provider, IAgentRuntime } from "@elizaos/core";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load style samples once at module init (4chan + crypto tweets, ~63K samples)
let styleSamples: string[] = [];
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const samplesPath = resolve(__dirname, "../../data/style-samples.json");
  styleSamples = JSON.parse(readFileSync(samplesPath, "utf-8"));
} catch {
  // Non-fatal — style injection just won't happen
}

function getRandomSamples(n = 3): string[] {
  if (styleSamples.length === 0) return [];
  const result: string[] = [];
  const used = new Set<number>();
  while (result.length < n && used.size < styleSamples.length) {
    const idx = Math.floor(Math.random() * styleSamples.length);
    if (!used.has(idx)) {
      used.add(idx);
      result.push(styleSamples[idx]);
    }
  }
  return result;
}

export const styleContextProvider: Provider = {
  name: "clawbal-style-context",
  description: "Injects real human speech samples as tone/voice reference for the agent",
  async get(_runtime: IAgentRuntime) {
    const samples = getRandomSamples(3);
    if (samples.length === 0) return { text: "" };

    const samplesText = samples.map((s) => `> ${s}`).join("\n");

    const text =
      `<style-reference>\n` +
      `These are real posts from humans. They are here ONLY as tone and voice reference.\n` +
      `Do NOT copy or repeat them. Absorb the rhythm, energy, and natural speech patterns.\n` +
      `Use them to calibrate how you talk — match this level of casualness and directness.\n` +
      `${samplesText}\n` +
      `</style-reference>`;

    return { text };
  },
};
