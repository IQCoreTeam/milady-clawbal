// Asset dir is set at runtime via setAssetDir() — no default
export let ASSET_DIR = "";
export function setAssetDir(dir: string) { ASSET_DIR = dir; }

export const LAYERS = [
  { name: "Background",      z: 0                      },
  { name: "Skin",            z: 1                      },
  { name: "UnclothedBase",   z: 1,   hidden: true      }, // Skin substitute, not directly selectable
  { name: "Face",            z: 2                      },
  { name: "Eyes",            z: 3                      },
  { name: "Eye Color",       z: 4                      },
  { name: "Mouth",           z: 4                      },
  { name: "Neck",            z: 5                      },
  { name: "Necklaces",       z: 5,   noneChance: 2 / 3 },  // 1/3 chance to appear
  { name: "Shirt",           z: 6                      },
  { name: "Hair",            z: 7                      },
  { name: "Brows",           z: 8                      },
  { name: "Earrings",        z: 9                      },
  { name: "Face Decoration", z: 10,  noneChance: 0.8  },   // 1/5 chance to appear
  { name: "Glasses",         z: 10,  noneChance: 0.75 },   // 1/4 chance to appear
  { name: "Hat",             z: 11,  noneChance: 0.5  },   // 1/2 chance to appear
  { name: "Overlay",         z: 13,  noneChance: 0.9  },   // 1/10 chance to appear
] as const;

// Rules to disable other categories when a specific item is selected
export const EXCLUSIONS: Record<string, Record<string, string[]>> = {
  Hat:  { "Strawberry Hat": ["Hair", "Earrings"] },
  Eyes: { "Chinese": ["Brows"] },
};

// Eyes that support Eye Color masking
export const MASKABLE_EYES = ["Classic", "Crying", "Dilated", "Heart", "Sleepy", "Sparkle", "Teary"];

// Blend modes for sharp composite
export const BLEND_MODES: Record<string, Record<string, string>> = {
  Overlay: {
    "M1 Blood": "colour-burn",
    "M2 Blood": "colour-burn",
    "M3 Blood": "colour-burn",
    "M4 Blood": "colour-burn",
  },
};

// Z-index overrides
export const Z_OVERRIDES: Record<string, Record<string, number>> = {
  Overlay: { "Banana Sticker": 9 },
};

// Skin weights: Pink 80%, remaining 20% split evenly among others
export const SKIN_WEIGHTS: Record<string, number> = { Pink: 0.8 };
