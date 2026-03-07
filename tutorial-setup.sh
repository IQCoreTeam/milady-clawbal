#!/usr/bin/env bash
set -euo pipefail

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m  → %s\033[0m\n' "$*"; }
die()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*"; exit 1; }
step()  { printf '\n\033[1;37m━━━ [%s] %s ━━━\033[0m\n\n' "$1" "$2"; }
hint()  { printf '\033[0;90m    %s\033[0m\n' "$*"; }

MILADY_DIR="$HOME/milady"
KEYPAIR="$HOME/keypair.json"
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
read -rp "  Agent name [MiladyAgent]: " AGENT_NAME
AGENT_NAME=${AGENT_NAME:-MiladyAgent}
ok "agent name: ${AGENT_NAME}"

# ── 6. Write .env ────────────────────────────────────────
step "6/7" "Write Config"

ENV_FILE="$MILADY_DIR/.env"

# Use node to safely write values (handles special chars in keys)
export CFG_OPENROUTER_KEY="$OPENROUTER_KEY"
export CFG_SOLANA_KEY="$SOLANA_PRIVATE_KEY"
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
  "SOLANA_RPC_URL=https://api.mainnet-beta.solana.com",
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

SAFE_NAME=$(echo "$AGENT_NAME" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
CHARACTER_FILE="$MILADY_DIR/characters/${SAFE_NAME}.character.json"
mkdir -p "$MILADY_DIR/characters"

if [ -f "$CHARACTER_FILE" ]; then
  ok "character file already exists"
else
  export CFG_AGENT_NAME="$AGENT_NAME"
  export CFG_SAFE_NAME="$SAFE_NAME"
  export CFG_MILADY_DIR="$MILADY_DIR"
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

  ok "created $CHARACTER_FILE"
fi

hint "customize your agent: edit $CHARACTER_FILE"

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
info "  Docs:     https://github.com/IQCoreTeam/milady-clawbal#readme"
info "  Chat UI:  https://ai.iqlabs.dev/chat"
echo ""
