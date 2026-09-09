import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize the Cortex MCP Server
const server = new McpServer({
  name: "Cortex Gigabrain",
  version: "1.0.0"
});

// Create a tool that Cursor/Windsurf can call to fetch memory context
server.tool(
  "fetch_cortex_memory",
  "Fetch context from the central Cortex Hive Mind to answer user queries.",
  {
    query: z.string().describe("The user's implicit or explicit question to search memory for.")
  },
  async ({ query }) => {
    try {
      // Connect to our local Rust engine API (Phase 6)
      const response = await fetch("http://localhost:3030/v1/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "default_user",
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
        content: [{ type: "text", text: "Error: Could not connect to Cortex Core Rust Engine. Make sure it is running on port 3030." }]
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
