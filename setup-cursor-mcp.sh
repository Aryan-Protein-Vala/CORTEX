#!/usr/bin/env bash
set -e

echo "🧠 [CORTEX] Setting up Cursor & Claude Desktop Memory Wedge..."

# 0. Check Node.js >= 18
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed. Please install Node.js (v18+) to run Cortex MCP."
  exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js v18 or higher is required. Found $(node -v)."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$ROOT_DIR/cortex-mcp"
MCP_PATH="$MCP_DIR/index.js"

if [ ! -f "$MCP_PATH" ]; then
  echo "❌ Could not find cortex-mcp at $MCP_PATH"
  exit 1
fi

# Ensure dependencies are installed in cortex-mcp
if [ ! -d "$MCP_DIR/node_modules/@modelcontextprotocol/sdk" ]; then
  echo "📦 Installing MCP dependencies in $MCP_DIR..."
  (cd "$MCP_DIR" && npm install --silent --no-fund --no-audit)
fi

chmod +x "$MCP_PATH"

# 1. Setup local project .cursor/mcp.json
mkdir -p "$ROOT_DIR/.cursor"
CURSOR_CONFIG="$ROOT_DIR/.cursor/mcp.json"

cat << JSON > "$CURSOR_CONFIG"
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["$MCP_PATH"],
      "env": {
        "CORTEX_API_URL": "http://127.0.0.1:3030"
      }
    }
  }
}
JSON
echo "✅ Configured Cursor MCP at: $CURSOR_CONFIG"

# 2. Setup Claude Desktop with non-destructive merge
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$CLAUDE_DIR" ]; then
  CLAUDE_CONFIG="$CLAUDE_DIR/claude_desktop_config.json"
  
  node -e "
    const fs = require('fs');
    const path = '$CLAUDE_CONFIG';
    let cfg = { mcpServers: {} };
    if (fs.existsSync(path)) {
      try {
        cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
        if (!cfg.mcpServers) cfg.mcpServers = {};
      } catch (e) {
        console.error('⚠️ Existing Claude config was invalid JSON, backing up to .bak');
        fs.copyFileSync(path, path + '.bak');
        cfg = { mcpServers: {} };
      }
    }
    cfg.mcpServers.cortex = {
      command: 'node',
      args: ['$MCP_PATH'],
      env: {
        CORTEX_API_URL: 'http://127.0.0.1:3030'
      }
    };
    fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
    console.log('✅ Safely merged Cortex into Claude Desktop at:', path);
  "
fi

echo "🎉 Done! Cortex is now connected to Cursor & Claude Desktop."
echo "   Start the core engine with: cd cortex-core && cargo run"
