import { existsSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import {
  ASSET_DIR, LAYERS, EXCLUSIONS, MASKABLE_EYES,
  BLEND_MODES, Z_OVERRIDES, SKIN_WEIGHTS, setAssetDir,
} from "./milady-config.js";

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(items: string[], weights: Record<string, number>): string {
  const totalExplicit = Object.values(weights).reduce((s, w) => s + w, 0);
  const unweighted = items.filter(i => !(i in weights));
  const eachShare = unweighted.length > 0 ? (1 - totalExplicit) / unweighted.length : 0;

  const roll = Math.random();
  let cumulative = 0;
  for (const item of items) {
    cumulative += weights[item] ?? eachShare;
    if (roll < cumulative) return item;
  }
  return items[items.length - 1];
}

function listItems(category: string): string[] {
  const dir = join(ASSET_DIR, category);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".png"))
    .map(f => f.replace(".png", ""));
}

function getZ(category: string, item: string): number {
  const override = Z_OVERRIDES[category]?.[item];
  if (override !== undefined) return override;
  return LAYERS.find(l => l.name === category)!.z;
}

function getBlend(category: string, item: string): string | undefined {
  return BLEND_MODES[category]?.[item];
}

/** Roll random traits with rule-based exclusion/dependency handling. */
export function rollTraits(): { category: string; item: string }[] {
  const selected: Record<string, string> = {};

  const selectableLayers = LAYERS.filter(l => !("hidden" in l));

  for (const layer of selectableLayers) {
    const items = listItems(layer.name);
    if (items.length === 0) continue;

    if ("noneChance" in layer && Math.random() < layer.noneChance) {
      continue;
    }

    selected[layer.name] = layer.name === "Skin"
      ? pickWeighted(items, SKIN_WEIGHTS)
      : pickRandom(items);
  }

  if (selected["Eye Color"] && !MASKABLE_EYES.includes(selected["Eyes"])) {
    delete selected["Eye Color"];
  }

  for (const [cat, rules] of Object.entries(EXCLUSIONS)) {
    const item = selected[cat];
    if (item && rules[item]) {
      for (const excluded of rules[item]) {
        delete selected[excluded];
      }
    }
  }

  if (selected["Skin"]) {
    if (selected["Shirt"]) {
      selected["UnclothedBase"] = selected["Skin"];
    }
  }

  return Object.entries(selected)
    .map(([category, item]) => ({ category, item, z: getZ(category, item) }))
    .sort((a, b) => a.z - b.z)
    .map(({ category, item }) => ({ category, item }));
}

/** Compose trait layers into a single image and return as Buffer. Requires sharp. */
async function composeMilady(
  traits: { category: string; item: string }[]
): Promise<Buffer> {
  if (traits.length === 0) throw new Error("No traits to compose");

  // Dynamic import — sharp is optional
  const sharp = (await import("sharp")).default;

  const basePath = join(ASSET_DIR, traits[0].category, `${traits[0].item}.png`);
  let pipeline = sharp(basePath);

  if (traits.length > 1) {
    const overlays = traits.slice(1).map(({ category, item }) => {
      const input = join(ASSET_DIR, category, `${item}.png`);
      const blend = getBlend(category, item);
      return {
        input,
        top: 0,
        left: 0,
        ...(blend ? { blend: blend as any } : {}),
      };
    });
    pipeline = pipeline.composite(overlays as any);
  }

  return pipeline.png().toBuffer();
}

/**
 * Generate a random milady PFP.
 * Requires sharp + MILADY_ASSETS_PATH pointing to the layer assets.
 * Returns path to the generated PNG.
 */
export async function generateMiladyPFP(assetsPath: string): Promise<string> {
  setAssetDir(assetsPath);
  const traits = rollTraits();
  const buffer = await composeMilady(traits);

  const sharp = (await import("sharp")).default;
  const dest = join(tmpdir(), `milady-pfp-${Date.now()}.png`);
  await sharp(buffer).toFile(dest);

  return dest;
}

/** Check if milady generation is available (sharp + assets). */
export async function canGenerateMilady(assetsPath: string): Promise<boolean> {
  try {
    await import("sharp");
  } catch { return false; }
  if (!existsSync(assetsPath)) return false;
  if (!existsSync(join(assetsPath, "Skin"))) return false;
  return true;
}
