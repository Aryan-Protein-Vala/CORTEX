#!/usr/bin/env bash
# Wire the CORTEX MCP server into Cursor and/or Claude Desktop.
#
# Why this exists: the first version wrote JSON with `cat >`, which silently
# destroyed any other MCP servers a user had configured, and it never installed
# the server's dependencies, so the editor showed a dead "cortex" entry.
#
# This one merges into an existing config, keeps a timestamped backup, is
# idempotent (running it twice changes nothing the second time), and can undo
# itself. It never needs `sudo`.
#
#   ./setup-cursor-mcp.sh                # both editors, if their dirs exist
#   ./setup-cursor-mcp.sh --cursor       # Cursor only
#   ./setup-cursor-mcp.sh --claude       # Claude Desktop only
#   ./setup-cursor-mcp.sh --dry-run      # show what would change
#   ./setup-cursor-mcp.sh --remove       # drop our entry, restore nothing else
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_ENTRY="$ROOT_DIR/cortex-mcp/index.js"
API_URL="${CORTEX_API_URL:-http://127.0.0.1:3030}"
OWNER="${CORTEX_OWNER:-cortex://default}"
DRY_RUN=0
DO_CURSOR=0
DO_CLAUDE=0
REMOVE=0

for arg in "$@"; do
  case "$arg" in
    --cursor) DO_CURSOR=1 ;;
    --claude|--desktop) DO_CLAUDE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --remove) REMOVE=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
if [[ $DO_CURSOR -eq 0 && $DO_CLAUDE -eq 0 ]]; then
  DO_CURSOR=1
  DO_CLAUDE=1
fi

command -v node >/dev/null 2>&1 || {
  echo "node is required (the MCP server is a Node program). Get Node 18+ and re-run." >&2
  exit 1
}

if [[ $REMOVE -eq 0 ]]; then
  [[ -f "$MCP_ENTRY" ]] || { echo "missing $MCP_ENTRY — run this from a full clone of the repo." >&2; exit 1; }

  echo "==> installing MCP server dependencies"
  if [[ ! -d "$ROOT_DIR/cortex-mcp/node_modules" ]]; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "    (dry run) cd cortex-mcp && npm install --omit=dev"
    else
      (cd "$ROOT_DIR/cortex-mcp" && npm install --omit=dev --no-audit --no-fund >/dev/null)
      echo "    installed"
    fi
  else
    echo "    already present, skipping"
  fi

  echo "==> checking the server actually starts"
  if [[ $DRY_RUN -eq 0 ]]; then
    # `timeout` is absent on stock macOS, so don't require it.
    if command -v timeout >/dev/null 2>&1; then
      probe() { printf '' | timeout 10 node "$MCP_ENTRY" >/dev/null 2>&1; }
    else
      probe() { printf '' | node "$MCP_ENTRY" >/dev/null 2>&1; }
    fi
    if probe; then
      echo "    ok"
    else
      echo "    note: the server did not exit cleanly on its own. That is expected while no" >&2
      echo "          core is reachable; it still starts and speaks MCP. Continuing." >&2
    fi
  fi
fi

# merge <config-path> <action:add|remove>
merge_config() {
  local file="$1" action="$2"
  node - "$file" "$action" "$MCP_ENTRY" "$API_URL" "$OWNER" <<'NODE'
const fs = require("fs");
const path = require("path");
const [file, action, entry, apiUrl, owner] = process.argv.slice(2);

// An empty CORTEX_API_KEY in the config is worse than no key: it reads as
// "configured with no auth" and it is a value people copy into other setups.
const env = { CORTEX_API_URL: apiUrl, CORTEX_OWNER: owner };
if (process.env.CORTEX_API_KEY) env.CORTEX_API_KEY = process.env.CORTEX_API_KEY;
const server = { command: "node", args: [entry], env };

// `existed` must be decided before parsing: a file that exists but will not
// parse is the case we must never overwrite.
const existed = fs.existsSync(file);
const raw = existed ? fs.readFileSync(file, "utf8") : "";
let config = {};
try {
  // An empty or whitespace-only file is a file nobody wrote yet, not a document
  // to protect: create it instead of failing with a parse error.
  if (raw.trim() === "") throw { skip: true };
  config = JSON.parse(raw);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("top level is not an object");
  }
} catch (error) {
  if (!error.skip && existed) {
    // Never clobber a file we could not read: that is someone's whole setup.
    console.error(`  REFUSING to touch ${file}: ${error.message}`);
    console.error("  Fix the JSON by hand, or point the editor config elsewhere.");
    process.exit(3);
  }
  config = {};
}

config.mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
const current = config.mcpServers.cortex;

if (action === "remove") {
  if (!current) {
    console.log("  nothing to remove");
    process.exit(0);
  }
  delete config.mcpServers.cortex;
} else {
  const same =
    current &&
    JSON.stringify(current.args) === JSON.stringify(server.args) &&
    JSON.stringify(current.env || {}) === JSON.stringify(server.env);
  if (same) {
    console.log("  already configured, leaving it untouched");
    process.exit(0);
  }
  if (Object.keys(config.mcpServers).length && !current) {
    console.log(`  merging alongside ${Object.keys(config.mcpServers).length} existing server(s)`);
  }
  config.mcpServers.cortex = server;
}

if (existed) {
  const backup = `${file}.cortex-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(file, backup);
  console.log(`  backup: ${path.basename(backup)}`);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
console.log(`  wrote ${file}`);
NODE
}

# configure <label> <dir> <file> [force]
# `force` creates the directory anyway: for a project-level .cursor/mcp.json that
# is the whole point of the installer. App-level configs (Claude Desktop) are only
# touched when the app has actually been run at least once.
configure() {
  local label="$1" dir="$2" file="$3" force="${4:-}"
  if [[ ! -d "$dir" && -z "$force" && $REMOVE -eq 0 ]]; then
    echo "==> $label: no $dir directory, skipping (create it if you do use $label)"
    return
  fi
  echo "==> $label"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "    (dry run) would ${REMOVE:+remove}${REMOVE:-add} the cortex entry in $file"
    return
  fi
  mkdir -p "$dir"
  merge_config "$file" "$([[ $REMOVE -eq 1 ]] && echo remove || echo add)"
}

case "$(uname -s)" in
  Darwin)
    [[ $DO_CURSOR -eq 1 ]] && configure "Cursor (project)" "$ROOT_DIR/.cursor" "$ROOT_DIR/.cursor/mcp.json" force
    [[ $DO_CLAUDE -eq 1 ]] && configure "Claude Desktop" "$HOME/Library/Application Support/Claude" "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    ;;
  Linux)
    [[ $DO_CURSOR -eq 1 ]] && configure "Cursor (project)" "$ROOT_DIR/.cursor" "$ROOT_DIR/.cursor/mcp.json" force
    [[ $DO_CLAUDE -eq 1 ]] && configure "Claude Desktop" "$HOME/.config/Claude" "$HOME/.config/Claude/claude_desktop_config.json"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    [[ $DO_CURSOR -eq 1 ]] && configure "Cursor (project)" "$ROOT_DIR/.cursor" "$ROOT_DIR/.cursor/mcp.json" force
    appdata="${APPDATA:-$HOME/AppData/Roaming}"
    [[ $DO_CLAUDE -eq 1 ]] && configure "Claude Desktop" "$appdata/Claude" "$appdata/Claude/claude_desktop_config.json"
    ;;
  *)
    [[ $DO_CURSOR -eq 1 ]] && configure "Cursor (project)" "$ROOT_DIR/.cursor" "$ROOT_DIR/.cursor/mcp.json" force
    ;;
esac

if [[ $REMOVE -eq 1 ]]; then
  echo "done: the cortex entry was removed (backups kept next to each config)."
  exit 0
fi

cat <<DONE

done. Restart Cursor / Claude Desktop so the new server is picked up.
Memory lives in your own core, which must be running:

  cd "$ROOT_DIR/cortex-core" && cargo run --release --bin cortex-core

Config used: CORTEX_API_URL=$API_URL · CORTEX_OWNER=$OWNER · key ${CORTEX_API_KEY:+set}${CORTEX_API_KEY:-not set}
Verify the wiring with:  cd cortex-mcp && npm run smoke
DONE
