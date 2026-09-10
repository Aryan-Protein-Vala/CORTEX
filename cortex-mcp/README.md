# 🧠 Cortex MCP Server

> **Give Cursor, Claude Desktop, and Windsurf cross-model persistent memory in 30 seconds.**

No more pasting context. No more repeating architectural decisions. When you tell Claude Desktop or Cursor a rule once, every AI tool you use remembers it forever through the **Cortex Knowledge Mesh**.

---

## ⚡ 30-Second Quickstart

### 1. Cursor Setup
Add the following to `.cursor/mcp.json` (in your project or in `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["-y", "cortex-mcp"],
      "env": {
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}
```

*Or if running from local source:*
```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/absolute/path/to/cortex/cortex-mcp/index.js"],
      "env": {
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}
```

---

### 2. Claude Desktop Setup
Add this to your Claude Desktop configuration file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["-y", "cortex-mcp"],
      "env": {
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}
```

---

### 3. Windsurf Setup
In Windsurf Settings -> Model Context Protocol (MCP) -> Add Server:
- **Name:** `cortex`
- **Command:** `npx -y cortex-mcp`
- **Env:** `CORTEX_API_URL=http://localhost:3030`

---

## 🛠️ Provided Tools

| Tool | Purpose | Example Query |
|------|---------|---------------|
| `fetch_cortex_memory` | Retrieves relevant facts, relational graph context, and architectural rules | *"What database and authentication rules do we follow?"* |
| `store_cortex_memory` | Permanently saves architectural invariants, preferences, and facts | *"Never use raw SQL queries, always use Prisma or SurrealQL."* |
| `publish_to_global_mesh` | Shares verified team architecture patterns to the decentralized global mesh (`cortex://global`) | *"Publish our microservice auth blueprint to global mesh."* |

---

## ⚙️ Configuration & Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CORTEX_API_URL` | `http://localhost:3030` | The endpoint of the running `cortex-core` server |
| `CORTEX_API_KEY` | *(optional)* | Bearer authentication token for production deployments |

---

## 🚀 Running Cortex Core

Make sure your `cortex-core` daemon is running:
```bash
# In the cortex-core directory:
cargo run --release

# Or with Docker:
docker compose up -d
```
