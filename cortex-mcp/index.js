import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize the Cortex MCP Server
const server = new McpServer({
  name: "Cortex Gigabrain",
  version: "1.0.0"
});

const CORTEX_URL = process.env.CORTEX_API_URL || "http://localhost:3030";
const CORTEX_KEY = process.env.CORTEX_API_KEY || "";

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
    include_mesh: z.boolean().optional().describe("Whether to include collective knowledge from cortex://global")
  },
  async ({ query, uri, include_mesh }) => {
    try {
      if (uri && uri.startsWith('cortex://')) {
        const meshParam = include_mesh ? '&include_mesh=true' : '';
        const response = await fetch(`${CORTEX_URL}/v1/resolve?uri=${encodeURIComponent(uri)}${meshParam}`, {
          method: "GET",
          headers: getHeaders()
        });
        const data = await response.json();
        return {
          content: [{ type: "text", text: `[SYSTEM CORTEX CONTEXT (${uri}): ${data.context || JSON.stringify(data)}]` }]
        };
      }

      const response = await fetch(`${CORTEX_URL}/v1/recall`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          user_id: uri || "default_user",
          prompt: query,
          token_budget: 500
        })
      });
      
      const data = await response.json();
      
      return {
        content: [{ type: "text", text: `[SYSTEM CORTEX CONTEXT: ${data.briefing}]` }]
      };
    } catch (error) {
      console.error("Cortex API unreachable", error);
      return {
        content: [{ type: "text", text: `Error: Could not connect to Cortex Core Rust Engine on ${CORTEX_URL}.` }]
      };
    }
  }
);

// Create a tool that Cursor/Windsurf can call to store permanent memory
server.tool(
  "store_cortex_memory",
  "Permanently save a fact, preference, or concept into the central Cortex Hive Mind, optionally scoped by URI.",
  {
    fact: z.string().describe("The statement or fact to permanently store into memory, e.g. 'User prefers PostgreSQL over MongoDB'."),
    uri: z.string().optional().describe("Optional Cortex URI namespace, e.g. cortex://user_123 or cortex://team_eng")
  },
  async ({ fact, uri }) => {
    try {
      if (uri && uri.startsWith('cortex://')) {
        const response = await fetch(`${CORTEX_URL}/v1/inject`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ uri, text: fact })
        });
        const data = await response.json();
        return {
          content: [{ type: "text", text: `Successfully injected into Cortex URI ${uri}: ${data.message || 'Saved.'}` }]
        };
      }

      const response = await fetch(`${CORTEX_URL}/v1/ingest`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          user_id: "default_user",
          prompt: fact
        })
      });

      const data = await response.json();

      return {
        content: [{ type: "text", text: `Successfully stored into Cortex Hive Mind: ${data.message || 'Saved.'}` }]
      };
    } catch (error) {
      console.error("Cortex Ingest failed", error);
      return {
        content: [{ type: "text", text: `Error: Could not connect to Cortex Core Rust Engine on ${CORTEX_URL}.` }]
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
