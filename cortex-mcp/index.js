#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize the Cortex MCP Server
const server = new McpServer({
  name: "Cortex Gigabrain",
  version: "1.0.0"
});

const CORTEX_URL = process.env.CORTEX_API_URL || "http://127.0.0.1:3030";
const CORTEX_KEY = process.env.CORTEX_API_KEY || "";
const DEFAULT_USER = process.env.CORTEX_USER_ID || "default_user";

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (CORTEX_KEY) {
    headers["Authorization"] = `Bearer ${CORTEX_KEY}`;
  }
  return headers;
}

// Create a tool that Cursor/Windsurf can call to fetch memory context
server.tool(
  "fetch_cortex_memory",
  "Fetch context from the central Cortex Hive Mind to answer user queries, optionally scoped by URI and global mesh.",
  {
    query: z.string().describe("The user's implicit or explicit question to search memory for."),
    uri: z.string().optional().describe("Optional Cortex URI namespace, e.g. cortex://user_123 or cortex://team_eng"),
    user_id: z.string().optional().describe("Optional user ID to isolate memories. Defaults to CORTEX_USER_ID or 'default_user'."),
    include_mesh: z.boolean().optional().describe("Whether to include collective knowledge from cortex://global")
  },
  async ({ query, uri, user_id, include_mesh }) => {
    const targetUser = user_id || DEFAULT_USER;
    try {
      if (uri && uri.startsWith('cortex://')) {
        const meshParam = include_mesh ? '&include_mesh=true' : '';
        const response = await fetch(`${CORTEX_URL}/v1/resolve?uri=${encodeURIComponent(uri)}${meshParam}`, {
          method: "GET",
          headers: getHeaders(),
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Cortex Core returned HTTP error ${response.status} on resolve.` }]
          };
        }
        const data = await response.json();
        return {
          content: [{ type: "text", text: `[SYSTEM CORTEX CONTEXT (${uri}): ${data.context || JSON.stringify(data)}]` }]
        };
      }

      const response = await fetch(`${CORTEX_URL}/v1/recall`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          user_id: targetUser,
          prompt: query,
          token_budget: 500
        }),
        signal: AbortSignal.timeout(3000)
      });
      
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cortex Core returned HTTP error ${response.status} on recall.` }]
        };
      }

      const data = await response.json();
      const briefing = data.briefing || data.context || "";
      
      if (!briefing || briefing.includes("No prior relevant memories found")) {
        return {
          content: [{ type: "text", text: `[SYSTEM CORTEX CONTEXT: No relevant memories found in brain for user '${targetUser}'. Use 'store_cortex_memory' to save important user rules, stack choices, and architectural decisions.]` }]
        };
      }

      return {
        content: [{ type: "text", text: `[SYSTEM CORTEX CONTEXT:\n${briefing}]` }]
      };
    } catch (error) {
      console.error("Cortex API unreachable", error);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: Could not connect to Cortex Core Rust Engine on ${CORTEX_URL} within 3000ms. Ensure cortex-core is running via 'cargo run'.` }]
      };
    }
  }
);

// Create a tool that Cursor/Windsurf can call to store permanent memory
server.tool(
  "store_cortex_memory",
  "Permanently save a fact, preference, or architectural rule into the central Cortex Hive Mind, optionally scoped by URI.",
  {
    fact: z.string().describe("The statement or fact to permanently store into memory, e.g. 'User prefers PostgreSQL over MongoDB' or 'Always use Tailwind v4'."),
    uri: z.string().optional().describe("Optional Cortex URI namespace, e.g. cortex://user_123 or cortex://team_eng"),
    user_id: z.string().optional().describe("Optional user ID to isolate memories. Defaults to CORTEX_USER_ID or 'default_user'.")
  },
  async ({ fact, uri, user_id }) => {
    const targetUser = user_id || DEFAULT_USER;
    try {
      if (uri && uri.startsWith('cortex://')) {
        const response = await fetch(`${CORTEX_URL}/v1/inject`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ uri, text: fact }),
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Cortex Core returned HTTP error ${response.status} on inject.` }]
          };
        }
        const data = await response.json();
        return {
          content: [{ type: "text", text: `Successfully injected into Cortex URI ${uri}: ${data.message || 'Saved.'}` }]
        };
      }

      const response = await fetch(`${CORTEX_URL}/v1/ingest`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          user_id: targetUser,
          prompt: fact
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cortex Core returned HTTP error ${response.status} on ingest.` }]
        };
      }

      const data = await response.json();

      return {
        content: [{ type: "text", text: `Successfully stored into Cortex Hive Mind: ${data.message || 'Saved.'}` }]
      };
    } catch (error) {
      console.error("Cortex Ingest failed", error);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: Could not connect to Cortex Core Rust Engine on ${CORTEX_URL} within timeout. Ensure cortex-core is running.` }]
      };
    }
  }
);

// Create a tool to check Cortex Core engine health & memory statistics
server.tool(
  "cortex_stats",
  "Inspect the current status and health of the Cortex Core memory daemon.",
  {},
  async () => {
    try {
      const response = await fetch(`${CORTEX_URL}/health`, {
        method: "GET",
        headers: getHeaders(),
        signal: AbortSignal.timeout(2000)
      });
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cortex daemon health check failed with status ${response.status}.` }]
        };
      }
      const data = await response.json();
      return {
        content: [{ type: "text", text: `Cortex Status: ${data.status} | Version: ${data.version} | SurrealDB: ${data.services?.graph_db ? "Connected" : "Offline"} | Qdrant: ${data.services?.vector_db ? "Connected" : "Offline"}` }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: Cortex daemon is unreachable at ${CORTEX_URL}.` }]
      };
    }
  }
);

// Create a tool to publish collective knowledge to the global mesh
server.tool(
  "publish_to_global_mesh",
  "Publish verified architecture rules or shared knowledge into the global decentralized mesh (cortex://global).",
  {
    nodes: z.array(z.any()).describe("List of memory nodes to publish to global mesh"),
    edges: z.array(z.any()).describe("List of relational edges connecting nodes")
  },
  async ({ nodes, edges }) => {
    try {
      const response = await fetch(`${CORTEX_URL}/v1/mesh/publish`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ nodes, edges }),
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cortex Core returned HTTP error ${response.status} on mesh publish.` }]
        };
      }
      const data = await response.json();
      return {
        content: [{ type: "text", text: `Successfully published to Global Mesh: ${data.message || 'Published.'}` }]
      };
    } catch (error) {
      console.error("Global mesh publish failed", error);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: Could not connect to Cortex Core on ${CORTEX_URL}.` }]
      };
    }
  }
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🧠 [CORTEX] MCP Server started. Big Tech is cooked.");
}

run().catch((error) => {
  console.error("Fatal error starting Cortex MCP server:", error);
  process.exit(1);
});

