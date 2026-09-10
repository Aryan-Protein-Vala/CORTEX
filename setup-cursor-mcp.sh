#!/usr/bin/env bash
set -e

echo "🧠 [CORTEX] Setting up Cursor & Claude Desktop Memory Wedge..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_PATH="$ROOT_DIR/cortex-mcp/index.js"

if [ ! -f "$MCP_PATH" ]; then
  echo "❌ Could not find cortex-mcp at $MCP_PATH"
  exit 1
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
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}
JSON
echo "✅ Configured Cursor MCP at: $CURSOR_CONFIG"

# 2. Setup Claude Desktop if on macOS
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$CLAUDE_DIR" ]; then
  CLAUDE_CONFIG="$CLAUDE_DIR/claude_desktop_config.json"
  if [ -f "$CLAUDE_CONFIG" ]; then
    echo "ℹ️  Existing Claude Desktop config found at $CLAUDE_CONFIG."
    echo "   Ensure 'cortex' server is added to mcpServers in $CLAUDE_CONFIG."
  else
    cat << JSON > "$CLAUDE_CONFIG"
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["$MCP_PATH"],
      "env": {
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}
JSON
    echo "✅ Created Claude Desktop MCP config at: $CLAUDE_CONFIG"
  fi
fi

echo "🎉 Done! Cortex is now connected to Cursor & Claude Desktop."
echo "   Start the core engine with: cd cortex-core && cargo run"
