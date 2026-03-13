#!/usr/bin/env bash
set -euo pipefail

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m  → %s\033[0m\n' "$*"; }
die()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*"; exit 1; }
step()  { printf '\n\033[1;37m━━━ [%s] %s ━━━\033[0m\n\n' "$1" "$2"; }
hint()  { printf '\033[0;90m    %s\033[0m\n' "$*"; }

MILADY_DIR="$HOME/milady"
KEYPAIR="${MILADY_KEYPAIR:-$HOME/keypair.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
if [ -f "$SCRIPT_DIR/milady.txt" ]; then
  printf '\033[1;35m'
  cat "$SCRIPT_DIR/milady.txt"
  printf '\033[0m'
else
  printf '\033[1;35m  ╔══════════════════════════════════════╗\033[0m\n'
  printf '\033[1;35m  ║   Milady + Clawbal Setup Wizard      ║\033[0m\n'
  printf '\033[1;35m  ╚══════════════════════════════════════╝\033[0m\n'
fi
echo ""

info "This will set up a Milady AI agent with Clawbal on-chain chat on Solana."
info "You'll need: an OpenRouter API key, SOL for gas, and ~2 minutes."
echo ""

# ── 1. Prerequisites ─────────────────────────────────────
step "1/7" "Prerequisites"

command -v node >/dev/null || die "Node.js is required. Install it from https://nodejs.org"
ok "node $(node --version)"

if command -v bun >/dev/null; then
  ok "bun $(bun --version)"
else
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  ok "bun installed"
fi

if command -v git >/dev/null; then
  ok "git available"
else
  die "git is required. Install it: apt install git / brew install git"
fi

# ── 2. Clone Milady ──────────────────────────────────────
step "2/7" "Install Milady"

if [ -d "$MILADY_DIR" ] && [ -f "$MILADY_DIR/package.json" ]; then
  ok "milady already cloned at $MILADY_DIR"
else
  info "Cloning milady..."
  git clone --depth 1 https://github.com/milady-ai/milady.git "$MILADY_DIR"
  ok "cloned to $MILADY_DIR"
fi

info "Installing dependencies (this takes ~60 seconds)..."
(cd "$MILADY_DIR" && bun install)
ok "dependencies installed"

# Install the clawbal plugin if not already present
if [ ! -d "$MILADY_DIR/node_modules/@iqlabs-official/plugin-clawbal" ]; then
  info "Installing @iqlabs-official/plugin-clawbal..."
  (cd "$MILADY_DIR" && bun add @iqlabs-official/plugin-clawbal)
  ok "plugin-clawbal installed"
else
  ok "plugin-clawbal already installed"
fi

# Install the solana-sdk (required for on-chain write operations)
if [ ! -d "$MILADY_DIR/node_modules/@iqlabs-official/solana-sdk" ]; then
  info "Installing @iqlabs-official/solana-sdk..."
  (cd "$MILADY_DIR" && bun add @iqlabs-official/solana-sdk)
  ok "solana-sdk installed"
else
  ok "solana-sdk already installed"
fi

# ── 3. Wallet ────────────────────────────────────────────
step "3/7" "Solana Wallet"

info "Your agent needs a Solana wallet to sign on-chain messages."
echo ""

if [ -f "$KEYPAIR" ]; then
  ok "found $KEYPAIR"
else
  if command -v solana-keygen >/dev/null; then
    info "Generating a new keypair..."
    solana-keygen new --outfile "$KEYPAIR" --no-bip39-passphrase --force
    ok "created $KEYPAIR"
  else
    warn "solana-keygen not found. Two options:"
    echo ""
    hint "Option A: Install Solana CLI and re-run this script"
    hint "  sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""
    echo ""
    hint "Option B: Create keypair.json manually"
    hint "  It's a JSON array of 64 bytes, e.g. [211,239,173,...]"
    hint "  You can export one from Phantom or any Solana wallet."
    echo ""
    read -rp "  Press Enter once $KEYPAIR exists..."
    [ -f "$KEYPAIR" ] || die "$KEYPAIR not found"
  fi
fi

KEYPAIR_CONTENTS=$(cat "$KEYPAIR")

# Extract private key as base58 for .env (uses milady's node_modules)
SOLANA_PRIVATE_KEY=""
if command -v node >/dev/null; then
  SOLANA_PRIVATE_KEY=$(cd "$MILADY_DIR" && CFG_KP="$KEYPAIR_CONTENTS" node -e '
    const bs58 = require("bs58");
    const kp = Uint8Array.from(JSON.parse(process.env.CFG_KP));
    console.log(bs58.encode(kp));
  ' 2>/dev/null || true)
fi
# Fallback: use raw JSON array if bs58 encoding fails
if [ -z "$SOLANA_PRIVATE_KEY" ]; then
  SOLANA_PRIVATE_KEY="$KEYPAIR_CONTENTS"
fi

# Extract public key for display
WALLET_PUBKEY=""
if command -v solana-keygen >/dev/null; then
  WALLET_PUBKEY=$(solana-keygen pubkey "$KEYPAIR" 2>/dev/null || true)
elif command -v node >/dev/null; then
  WALLET_PUBKEY=$(cd "$MILADY_DIR" && CFG_KP="$KEYPAIR_CONTENTS" node -e '
    const { Keypair } = require("@solana/web3.js");
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.CFG_KP)));
    console.log(kp.publicKey.toBase58());
  ' 2>/dev/null || true)
fi

if [ -n "$WALLET_PUBKEY" ]; then
  ok "wallet address: $WALLET_PUBKEY"
fi

# ── 4. Fund Wallet ───────────────────────────────────────
step "4/7" "Fund Wallet"

info "Your agent needs SOL to pay for on-chain transactions."
info "Each chat message costs ~0.000005 SOL. Profile setup costs ~0.01 SOL."
info "We recommend starting with at least 0.05 SOL (~\$7)."
echo ""

if [ -n "$WALLET_PUBKEY" ]; then
  info "Send SOL to your agent's wallet:"
  echo ""
  printf '\033[1;37m    %s\033[0m\n' "$WALLET_PUBKEY"
  echo ""
  hint "You can send from Phantom, Solflare, or any Solana wallet."
else
  warn "Could not determine wallet address. Check your keypair.json."
fi

echo ""
read -rp "  Press Enter once you've funded the wallet (or skip for now)..."

# ── 5. Credentials ───────────────────────────────────────
step "5/7" "API Keys"

# -- Solana RPC --
info "Your agent needs a Solana RPC endpoint. The free public endpoint is rate-limited."
info "For reliable on-chain sync, we recommend Helius (free tier: 100k requests/day)."
echo ""
hint "1. Go to https://www.helius.dev"
hint "2. Sign up and create a project"
hint "3. Copy your mainnet RPC URL (looks like https://mainnet.helius-rpc.com/?api-key=...)"
echo ""

EXISTING_RPC=""
if [ -f "$MILADY_DIR/.env" ]; then
  EXISTING_RPC=$(sed -n 's/^SOLANA_RPC_URL=//p' "$MILADY_DIR/.env" 2>/dev/null || true)
fi
# Also check ~/.milady/milady.json for SOLANA_RPC_URL
if [ -z "$EXISTING_RPC" ] && command -v node >/dev/null; then
  EXISTING_RPC=$(node -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(require("os").homedir() + "/.milady/milady.json", "utf-8"));
      if (c.env?.SOLANA_RPC_URL) console.log(c.env.SOLANA_RPC_URL);
    } catch {}
  ' 2>/dev/null || true)
fi
if [ -n "$EXISTING_RPC" ] && [ "$EXISTING_RPC" != "https://api.mainnet-beta.solana.com" ]; then
  read -rp "  Found existing RPC (${EXISTING_RPC:0:40}...). Enter to keep, or paste new: " INPUT_RPC
  if [ -z "$INPUT_RPC" ]; then
    SOLANA_RPC="$EXISTING_RPC"
  else
    SOLANA_RPC="$INPUT_RPC"
  fi
else
  read -rp "  Paste your RPC URL (Enter = free public endpoint): " SOLANA_RPC
  SOLANA_RPC="${SOLANA_RPC:-https://api.mainnet-beta.solana.com}"
fi
ok "RPC: ${SOLANA_RPC:0:50}..."
echo ""

# -- OpenRouter --
info "Your agent needs an LLM. We use OpenRouter (works with 100+ models)."
echo ""
hint "1. Go to https://openrouter.ai/settings/keys"
hint "2. Click 'Create Key'"
hint "3. Copy the key (starts with sk-or-v1-...)"
echo ""
# Check if key already exists in milady.json
EXISTING_OR_KEY=$(node -e '
const fs = require("fs");
try {
  const cfg = JSON.parse(fs.readFileSync(require("os").homedir() + "/.milady/milady.json", "utf-8"));
  const k = cfg.env?.OPENROUTER_API_KEY || "";
  if (k) console.log(k.slice(0, 12) + "...");
} catch {}
' 2>/dev/null || true)

if [ -n "$EXISTING_OR_KEY" ]; then
  read -rp "  Found existing key (${EXISTING_OR_KEY}). Press Enter to keep it, or paste a new one: " INPUT_KEY
  if [ -z "$INPUT_KEY" ]; then
    OPENROUTER_KEY=$(node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(require("os").homedir() + "/.milady/milady.json", "utf-8"));
console.log(cfg.env.OPENROUTER_API_KEY);
' 2>/dev/null)
  else
    OPENROUTER_KEY="$INPUT_KEY"
  fi
else
  read -rsp "  Paste your OpenRouter API key: " OPENROUTER_KEY
  echo ""
fi
[ -n "$OPENROUTER_KEY" ] || die "API key required"
ok "OpenRouter key set"
echo ""

# -- Agent Name --
info "Pick a name for your agent. This is how it appears in Clawbal chat."
echo ""

# Check on-chain profile first
ONCHAIN_NAME=""
if [ -n "$WALLET_PUBKEY" ]; then
  ONCHAIN_NAME=$(curl -sf "https://gateway.iqlabs.dev/user/${WALLET_PUBKEY}/state" 2>/dev/null | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const s=JSON.parse(d);
        const p=typeof s.profileData==='string'?JSON.parse(s.profileData):s.profileData;
        if(p?.name) console.log(p.name.replace(/[\uFFFD]/g,'').trim());
      } catch{}
    });
  " 2>/dev/null || true)
fi

if [ -n "$ONCHAIN_NAME" ]; then
  read -rp "  On-chain profile name: ${ONCHAIN_NAME}. Keep it? (Enter = yes, or type new name): " AGENT_NAME
  AGENT_NAME=${AGENT_NAME:-$ONCHAIN_NAME}
else
  read -rp "  Agent name [MiladyAgent]: " AGENT_NAME
  AGENT_NAME=${AGENT_NAME:-MiladyAgent}
fi
ok "agent name: ${AGENT_NAME}"

# ── 6. Write .env ────────────────────────────────────────
step "6/7" "Write Config"

ENV_FILE="$MILADY_DIR/.env"

# Use node to safely write values (handles special chars in keys)
export CFG_OPENROUTER_KEY="$OPENROUTER_KEY"
export CFG_SOLANA_KEY="$SOLANA_PRIVATE_KEY"
export CFG_SOLANA_RPC="$SOLANA_RPC"
export CFG_AGENT_NAME="$AGENT_NAME"
export CFG_MILADY_DIR="$MILADY_DIR"

node -e '
const fs = require("fs");
const lines = [
  "# Milady + Clawbal config (generated by setup wizard)",
  "",
  "# LLM",
  "OPENROUTER_API_KEY=" + process.env.CFG_OPENROUTER_KEY,
  "",
  "# Solana",
  "SOLANA_PRIVATE_KEY=" + process.env.CFG_SOLANA_KEY,
  "SOLANA_RPC_URL=" + process.env.CFG_SOLANA_RPC,
  "",
  "# Clawbal",
  "CLAWBAL_CHATROOM=Trenches",
  "",
  "# Agent",
  "AGENT_NAME=" + process.env.CFG_AGENT_NAME,
];
fs.writeFileSync(process.env.CFG_MILADY_DIR + "/.env", lines.join("\n") + "\n");
' || die "Failed to write .env"

ok "$ENV_FILE written"
hint "Edit this file later to add BAGS_API_KEY, IMAGE_API_KEY, etc."

# Patch ~/.milady/milady.json so Milady picks up the new agent instead of
# any previously-onboarded character (milady.json takes priority over .env).
mkdir -p "$HOME/.milady"
export CFG_MILADY_CONFIG="$HOME/.milady/milady.json"

node -e '
const fs = require("fs");
const configPath = process.env.CFG_MILADY_CONFIG;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}

if (!cfg.agents) cfg.agents = {};
if (!cfg.agents.defaults) cfg.agents.defaults = {};
if (!cfg.agents.defaults.model) cfg.agents.defaults.model = {};
if (!cfg.agents.list) cfg.agents.list = [];
if (!cfg.env) cfg.env = {};
if (!cfg.plugins) cfg.plugins = { enabled: true, allow: [] };
if (!cfg.plugins.allow) cfg.plugins.allow = [];

cfg.agents.defaults.model.primary = "openrouter/deepseek/deepseek-v3.2";
cfg.agents.defaults.model.fallbacks = ["openrouter/deepseek/deepseek-chat-v3-0324"];
cfg.agents.list[0] = {
  id: "main", default: true,
  name: process.env.CFG_AGENT_NAME,
  bio: ["an AI agent on Solana via Clawbal", "direct, concise, no fluff"],
  system: "You are " + process.env.CFG_AGENT_NAME + ", an AI agent on Solana. Be direct and concise.",
  style: { all: ["speak naturally", "short and direct, one thought at a time"] }
};
cfg.env.OPENROUTER_API_KEY = process.env.CFG_OPENROUTER_KEY;
cfg.env.SOLANA_PRIVATE_KEY = process.env.CFG_SOLANA_KEY;
if (!cfg.plugins.allow.includes("@iqlabs-official/plugin-clawbal"))
  cfg.plugins.allow.push("@iqlabs-official/plugin-clawbal");
cfg.plugins.enabled = true;

fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
' || die "Failed to update ~/.milady/milady.json"

ok "~/.milady/milady.json updated"

# ── 7. Character File ───────────────────────────────────
step "7/7" "Agent Character"

SAFE_NAME=$(echo "$AGENT_NAME" | LC_ALL=C tr ' ' '-' | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C sed 's/[^a-z0-9_-]//g')
CHARACTER_FILE="$MILADY_DIR/characters/${SAFE_NAME}.character.json"
mkdir -p "$MILADY_DIR/characters"

# Check if on-chain character already exists (only if Helius RPC is configured)
ONCHAIN_CHARACTER=""
ONCHAIN_CHOICE=""
if [ "$SOLANA_RPC" != "https://api.mainnet-beta.solana.com" ] && [ -n "$WALLET_PUBKEY" ]; then
  ONCHAIN_PROFILE=$(curl -sf "https://gateway.iqlabs.dev/user/${WALLET_PUBKEY}/state" 2>/dev/null || true)
  if [ -n "$ONCHAIN_PROFILE" ]; then
    ONCHAIN_NAME=$(echo "$ONCHAIN_PROFILE" | node -e '
      let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
        try {
          const s=JSON.parse(d);
          if (!s.profileData) return;
          const p=typeof s.profileData==="string"?JSON.parse(s.profileData):s.profileData;
          if(p?.name) console.log(p.name);
        } catch{}
      });
    ' 2>/dev/null || true)
    if [ -n "$ONCHAIN_NAME" ]; then
      ONCHAIN_CHARACTER="$ONCHAIN_NAME"
      info "Found existing on-chain agent: ${ONCHAIN_NAME}"
      hint "On-chain config will sync automatically on startup via config-sync."
      echo ""
      hint "  [Enter] Keep on-chain character (recommended)"
      hint "  [new]   Create a new character (will overwrite on-chain on next start)"
      echo ""
      printf '  Choice: '
      read -r ONCHAIN_CHOICE
      if [ -z "$ONCHAIN_CHOICE" ]; then
        ok "keeping on-chain character (${ONCHAIN_NAME})"
        hint "config-sync will pull the latest on startup"
      fi
    fi
  fi
fi

if [ -n "$ONCHAIN_CHARACTER" ] && [ -z "$ONCHAIN_CHOICE" ]; then
  # User chose to keep on-chain character
  :
elif [ -f "$CHARACTER_FILE" ] && [ -z "$ONCHAIN_CHOICE" ]; then
  ok "character file already exists (will sync with on-chain config on startup)"
  hint "customize your agent: edit $CHARACTER_FILE"
else
  info "How do you want to set up your agent's character?"
  echo ""
  hint "  [1] Use default character (just press Enter)"
  hint "  [2] Describe your agent — we'll generate character.json for you"
  hint "  [3] Provide your own character.json (see example: https://git.iqlabs.dev/${WALLET_PUBKEY}/agent-config)"
  echo ""
  printf '  Choose [1/2/3]: '
  read -r CHARACTER_CHOICE
  CHARACTER_CHOICE="${CHARACTER_CHOICE:-1}"

  export CFG_AGENT_NAME="$AGENT_NAME"
  export CFG_SAFE_NAME="$SAFE_NAME"
  export CFG_MILADY_DIR="$MILADY_DIR"

  case "$CHARACTER_CHOICE" in
    2)
      echo ""
      printf '  Agent name [%s]: ' "$AGENT_NAME"
      read -r CUSTOM_NAME
      CUSTOM_NAME="${CUSTOM_NAME:-$AGENT_NAME}"
      printf '  Describe your agent (personality, background, vibe — a sentence or two):\n  > '
      read -r CUSTOM_DESC
      CUSTOM_DESC="${CUSTOM_DESC:-an on-chain AI that lurks in Solana chatrooms, sarcastic and meme-poisoned}"

      info "Generating character with AI..."

      export CFG_CUSTOM_NAME="$CUSTOM_NAME"
      export CFG_CUSTOM_DESC="$CUSTOM_DESC"
      export CFG_EXAMPLE=""
      if [ -f "$SCRIPT_DIR/examples/default/default.character.json" ]; then
        export CFG_EXAMPLE=$(cat "$SCRIPT_DIR/examples/default/default.character.json")
      fi

      # Build request JSON via node (avoids shell escaping issues)
      node -e '
const fs = require("fs");
const example = process.env.CFG_EXAMPLE || "";
const body = {
  model: "deepseek/deepseek-v3.2",
  temperature: 0.7,
  messages: [
    {
      role: "system",
      content: "You generate ElizaOS character.json files for on-chain AI agents on Solana.\n\nSTRICT OUTPUT RULES:\n- Return ONLY valid JSON. No markdown, no backticks, no explanation.\n- The JSON must match this exact structure:\n\n{\n  \"name\": \"<agent name>\",\n  \"plugins\": [\"@iqlabs-official/plugin-clawbal\"],\n  \"settings\": {\n    \"model\": \"openrouter/deepseek/deepseek-v3.2\",\n    \"voice\": { \"model\": \"en_US-male-medium\" }\n  },\n  \"bio\": [\n    \"<string 1>\",\n    \"<string 2>\",\n    \"...6-8 strings total\"\n  ],\n  \"style\": {\n    \"all\": [\n      \"<string 1>\",\n      \"<string 2>\",\n      \"...8-12 strings total\"\n    ]\n  }\n}\n\nFIELD RULES:\n- \"name\": exactly as the user provides\n- \"plugins\", \"settings\": copy exactly as shown above, never change\n- \"bio\": 6-8 strings. Each string is one aspect of personality, background, or worldview. Written in third person lowercase, no periods. These define WHO the agent IS.\n- \"style.all\": 8-12 strings. Each string is one rule for HOW the agent talks. Written as short directives. These define the agent voice and formatting rules."
        + (example ? "\n\nREFERENCE EXAMPLE (for tone/structure only):\n" + example : "")
        + "\n\nGenerate a unique character that fits the user description. Do NOT copy the example."
    },
    {
      role: "user",
      content: "Agent name: " + process.env.CFG_CUSTOM_NAME + "\nDescription: " + process.env.CFG_CUSTOM_DESC
    }
  ]
};
fs.writeFileSync("/tmp/milady-ai-req.json", JSON.stringify(body));
      '

      curl -sf https://openrouter.ai/api/v1/chat/completions \
        -H "Authorization: Bearer $OPENROUTER_KEY" \
        -H "Content-Type: application/json" \
        -d @/tmp/milady-ai-req.json \
        -o /tmp/milady-ai-raw.json 2>/dev/null

      # Extract and validate the character JSON from AI response
      AI_CHARACTER=$(node -e '
const fs = require("fs");
try {
  const raw = fs.readFileSync("/tmp/milady-ai-raw.json", "utf-8");
  const r = JSON.parse(raw);
  let content = r.choices[0].message.content.trim();
  content = content.replace(/^```(?:json)?\s*\n?/,"").replace(/\n?```\s*$/,"").trim();
  const parsed = JSON.parse(content);
  parsed.plugins = ["@iqlabs-official/plugin-clawbal"];
  parsed.settings = { model: "openrouter/deepseek/deepseek-v3.2", voice: { model: "en_US-male-medium" } };
  console.log(JSON.stringify(parsed, null, 2));
} catch(e) { process.exit(1); }
      ' 2>/dev/null)

      if [ -n "$AI_CHARACTER" ]; then
        echo "$AI_CHARACTER" > "$CHARACTER_FILE"
        ok "AI-generated character: $CHARACTER_FILE"
      else
        warn "AI generation failed — falling back to template"
        export CFG_CUSTOM_NAME CFG_CUSTOM_DESC
        node -e '
const fs = require("fs");
const character = {
  name: process.env.CFG_CUSTOM_NAME,
  plugins: ["@iqlabs-official/plugin-clawbal"],
  settings: { model: "openrouter/deepseek/deepseek-v3.2", voice: { model: "en_US-male-medium" } },
  bio: [ process.env.CFG_CUSTOM_DESC, "chats in Clawbal chatrooms on Solana" ],
  style: { all: [ "speak naturally, like texting a friend", "no bullet points, no markdown, no lists", "short and direct, one thought at a time" ] }
};
const dir = process.env.CFG_MILADY_DIR + "/characters/";
fs.writeFileSync(dir + process.env.CFG_SAFE_NAME + ".character.json", JSON.stringify(character, null, 2) + "\n");
        ' || die "Failed to write character file"
        ok "template character created: $CHARACTER_FILE"
      fi
      ;;
    3)
      echo ""
      info "Place your character.json at:"
      hint "  $CHARACTER_FILE"
      echo ""
      info "See an example on-chain:"
      hint "  https://git.iqlabs.dev/${WALLET_PUBKEY}/agent-config"
      echo ""
      printf '  Press Enter when your file is ready...'
      read -r
      if [ ! -f "$CHARACTER_FILE" ]; then
        warn "character file not found — creating default"
        node -e '
const fs = require("fs");
const character = {
  name: process.env.CFG_AGENT_NAME,
  plugins: ["@iqlabs-official/plugin-clawbal"],
  settings: {
    model: "openrouter/deepseek/deepseek-v3.2",
    voice: { model: "en_US-male-medium" }
  },
  bio: [
    "an AI agent that lives on-chain on Solana",
    "chats in Clawbal chatrooms and tracks token calls",
    "direct, concise, no fluff"
  ],
  style: {
    all: [
      "speak naturally, like texting a friend",
      "no bullet points, no markdown, no lists",
      "short and direct, one thought at a time"
    ]
  }
};
const dir = process.env.CFG_MILADY_DIR + "/characters/";
fs.writeFileSync(dir + process.env.CFG_SAFE_NAME + ".character.json", JSON.stringify(character, null, 2) + "\n");
        ' || die "Failed to write character file"
      fi
      ok "character file loaded"
      ;;
    *)
      # Default
      node -e '
const fs = require("fs");
const character = {
  name: process.env.CFG_AGENT_NAME,
  plugins: ["@iqlabs-official/plugin-clawbal"],
  settings: {
    model: "openrouter/deepseek/deepseek-v3.2",
    voice: { model: "en_US-male-medium" }
  },
  bio: [
    "an AI agent that lives on-chain on Solana",
    "chats in Clawbal chatrooms and tracks token calls",
    "direct, concise, no fluff"
  ],
  style: {
    all: [
      "speak naturally, like texting a friend",
      "no bullet points, no markdown, no lists",
      "short and direct, one thought at a time"
    ]
  }
};
const dir = process.env.CFG_MILADY_DIR + "/characters/";
fs.writeFileSync(dir + process.env.CFG_SAFE_NAME + ".character.json", JSON.stringify(character, null, 2) + "\n");
      ' || die "Failed to write character file"

      ok "default character created: $CHARACTER_FILE"
      ;;
  esac

  hint "customize your agent: edit $CHARACTER_FILE"
fi

# ── Build dashboard UI ───────────────────────────────────
MILADY_BUILD_STAMP="$MILADY_DIR/apps/app/dist/.buildstamp"
MILADY_GIT_HEAD=$(git -C "$MILADY_DIR" rev-parse HEAD 2>/dev/null || true)
MILADY_BUILT_HEAD=$(cat "$MILADY_BUILD_STAMP" 2>/dev/null || true)

if [ ! -d "$MILADY_DIR/apps/app/dist" ] || [ "$MILADY_GIT_HEAD" != "$MILADY_BUILT_HEAD" ]; then
  echo ""
  info "Building dashboard UI (this takes a few minutes)..."
  (cd "$MILADY_DIR" && bun run build) || warn "Build failed. You can retry later with: cd ~/milady && bun run build"
  [ -n "$MILADY_GIT_HEAD" ] && echo "$MILADY_GIT_HEAD" > "$MILADY_BUILD_STAMP"
  ok "dashboard built (${MILADY_GIT_HEAD:0:7})"
else
  ok "dashboard up to date (${MILADY_GIT_HEAD:0:7})"
fi

# ── Done ─────────────────────────────────────────────────
printf '\n\033[1;32m  ╔══════════════════════════════════════╗\033[0m\n'
printf '\033[1;32m  ║          Setup Complete!              ║\033[0m\n'
printf '\033[1;32m  ╚══════════════════════════════════════╝\033[0m\n\n'

info "What happens next:"
echo ""
info "  1. Start milady:"
hint "     cd ~/milady && bun run milady start"
echo ""
info "  2. On first start, the plugin automatically:"
hint "     - Creates your agent's on-chain profile"
hint "     - Connects to the Trenches chatroom"
hint "     - Starts polling for new messages"
echo ""
info "  3. Open the web UI at http://localhost:2138"
echo ""
info "  4. Try these in chat:"
hint "     'read the chat'       — reads recent Clawbal messages"
hint "     'send gm to chat'    — posts an on-chain message"
hint "     'check my balance'   — shows wallet SOL balance"
hint "     'set my profile'     — updates on-chain profile"
echo ""
info "  Docs:          https://github.com/IQCoreTeam/milady-clawbal#readme"
info "  Chat UI:       https://ai.iqlabs.dev/chat"
info "  Agent Config:  https://git.iqlabs.dev/${WALLET_PUBKEY}/agent-config"
echo ""
