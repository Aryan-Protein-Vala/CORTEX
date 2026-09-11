#!/usr/bin/env node
/**
 * CORTEX MCP server — durable memory for coding agents.
 *
 * Every tool here is a thin, honest wrapper over the local CORTEX core:
 *  - errors are returned as MCP errors (`isError: true`), never as text that
 *    reads like a success ("No specific memory found." used to be indistinguishable
 *    from "the engine is down").
 *  - nothing is faked when the core is unreachable.
 *  - writes use `wait: true`, so `remember` can report what was actually stored.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const env = process.env;
const CORE_URL = (env.CORTEX_API_URL || "http://127.0.0.1:3030").replace(/\/+$/, "");
const API_KEY = env.CORTEX_API_KEY || "";
const OWNER = env.CORTEX_OWNER || "cortex://default";
const TOKEN_BUDGET = clampInt(env.CORTEX_TOKEN_BUDGET, 500, 32, 8000);
const TIMEOUT_MS = clampInt(env.CORTEX_TIMEOUT_MS, 20000, 1000, 120000);
const INCLUDE_MESH = env.CORTEX_INCLUDE_MESH === "1" || env.CORTEX_INCLUDE_MESH === "true";
const MAX_FILE_BYTES = clampInt(env.CORTEX_MAX_FILE_BYTES, 200_000, 1024, 2_000_000);
// Directories the file-ingest tool may read. Empty means the tool refuses to run.
const READ_DIRS = (env.CORTEX_READ_DIRS || "")
  .split(path.delimiter)
  .map((d) => d.trim())
  .filter(Boolean);

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".py", ".go", ".java", ".kt",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".sql", ".sh", ".bash",
  ".json", ".toml", ".yaml", ".yml", ".md", ".mdx", ".css", ".scss", ".html",
]);
const SKIP_NAMES = new Set([
  "node_modules", ".git", "target", "dist", "build", ".next", ".venv", "venv",
  "__pycache__", "vendor", ".cache", "coverage", ".turbo", "out",
]);

const DEFAULT_FILE_NAMES = [
  "AGENTS.md", "CLAUDE.md", "README.md", "package.json", "tsconfig.json",
  "Cargo.toml", "pyproject.toml", ".editorconfig", ".eslintrc.json",
];

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Core client
// ---------------------------------------------------------------------------

class CoreError extends Error {
  constructor(message, { status, code, hint } = {}) {
    super(message);
    this.name = "CoreError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const START_HINT =
  "Start it with `cargo run --release --bin cortex-core` from the cortex-core directory " +
  "(or set CORTEX_API_URL if it listens elsewhere).";

async function core(route, { method = "POST", body, query, expectJson = true } = {}) {
  const url = new URL(route, CORE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  // The core accepts either header; a key in the URL is only for browsers.
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : error?.message;
    throw new CoreError(`CORTEX core at ${CORE_URL} is unreachable (${reason}). ${START_HINT}`, {
      code: "core_unreachable",
    });
  }

  const text = await response.text();
  let payload;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const err = payload?.error ?? {};
    const code = err.code || `http_${response.status}`;
    const message = err.message || `CORTEX core returned HTTP ${response.status}`;
    // 401/403 need an actionable message; the user has to edit their MCP config.
    const hint =
      response.status === 401 || response.status === 403
        ? API_KEY
          ? "The core rejected this key — set CORTEX_API_KEY in the MCP server env to match its CORTEX_API_KEY."
          : "This core requires a key: set CORTEX_API_KEY in the MCP server env."
        : undefined;
    throw new CoreError(`${message} (${code})`, { status: response.status, code, hint });
  }

  return expectJson ? payload ?? {} : text;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function text(content) {
  return { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }] };
}

function fail(error) {
  const message = error instanceof CoreError ? error.message : `Unexpected MCP failure: ${error?.message ?? error}`;
  const shown = error instanceof CoreError && error.hint ? `${message}\n${error.hint}` : message;
  return {
    content: [{ type: "text", text: shown }],
    // Without this flag the model reads transport errors as ordinary context.
    isError: true,
  };
}

function summarizeRecall(data) {
  const briefing = (data.briefing || "").trim();
  if (!briefing) {
    return [
      `No relevant memories found for this query in ${data.owner_uri || OWNER}`,
      `(scanned ${data.scanned ?? 0} nodes, budget ${data.tokens_used ?? 0}/${data.token_budget ?? TOKEN_BUDGET} tokens).`,
      "If you expected a hit, the fact may be filed under another owner — pass `uri`.",
    ].join(" ");
  }
  const flags = [];
  if (data.truncated) flags.push(`TRUNCATED to fit the ${data.token_budget}-token budget`);
  const header =
    `[CORTEX MEMORY] ${data.memories_found ?? 0} relevant memories` +
    ` (${data.tokens_used ?? 0}/${data.token_budget ?? TOKEN_BUDGET} tokens${flags.length ? `; ${flags.join("; ")}` : ""}). ` +
    "Treat these as the user's established facts and constraints; follow them unless the user overrides them now.";
  return `${header}\n\n${briefing}`;
}

// ---------------------------------------------------------------------------
// Label → id resolution
// ---------------------------------------------------------------------------

/**
 * Models do not carry opaque ids around; they remember what a fact was about.
 * Every destructive tool therefore accepts a label as well, resolved against the
 * owner's own memory list (`/v1/memories?q=`), and refuses to act on a fuzzy
 * match when several nodes could have been meant.
 */
async function findNode({ node_id, label, uri }) {
  const owner = uri || OWNER;
  if (node_id) {
    const list = await core("/v1/memories", { method: "GET", query: { owner, limit: 2000 } });
    const hit = (list.memories ?? []).find((n) => n.id === node_id);
    return hit ?? { id: node_id, label: node_id, unresolved: true };
  }
  if (!label) return null;
  const list = await core("/v1/memories", { method: "GET", query: { owner, q: label, limit: 2000 } });
  const exact = (list.memories ?? []).filter((n) => (n.label || "").toLowerCase() === String(label).toLowerCase());
  if (exact.length === 1) return exact[0];
  const candidates = exact.length ? exact : (list.memories ?? []).slice(0, 5);
  if (!candidates.length) return null;
  const error = new CoreError(
    `"${label}" matches ${candidates.length} memories in ${owner}, so nothing was changed.`,
    {
      code: "ambiguous_label",
      hint: `Pass node_id instead. Candidates: ${candidates.map((c) => `${c.label} (${c.id})`).join(", ")}`,
    }
  );
  throw error;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "cortex", version: "1.0.0" },
  {
    // Every capable client feeds this to the model, which is what makes recall
    // happen without the user asking for it.
    instructions: [
      "CORTEX is the user's persistent memory across sessions.",
      "Before answering anything about their stack, preferences, project rules, past decisions or identity, call `cortex_recall` with the question and honour what comes back.",
      "When the user states a durable fact, preference, correction or rule (\"always/never ...\"), call `cortex_remember` in the same turn. Do not store secrets, tokens, passwords or private third-party data.",
      "Use `cortex_forget` when the user says a memory is wrong or stale, and `cortex_lock` for rules that must never be forgotten.",
      "When a briefing names a concept the task hinges on, `cortex_expand` returns that memory's edges and neighbours — the graph, not just the line.",
      "Forgets and locks accept a label or a node_id; an ambiguous label is reported instead of guessed.",
      "The tools are best-effort: if a call fails, continue the task and mention the failure once.",
    ].join(" "),
  }
);

server.registerTool(
  "cortex_recall",
  {
    title: "Recall memory",
    description:
      "Search the user's persistent memory graph for a question. Returns a compact, token-budgeted briefing of facts, preferences and rules that apply. Call before answering questions about their stack, project conventions, past decisions or identity.",
    inputSchema: {
      query: z.string().min(1).describe("What to recall, phrased as the user's question or task."),
      uri: z.string().optional().describe("Memory namespace to search, e.g. cortex://team_eng. Defaults to the configured CORTEX_OWNER."),
      token_budget: z.number().int().min(32).max(8000).optional().describe("Hard cap on injected tokens. Defaults to CORTEX_TOKEN_BUDGET."),
      include_mesh: z.boolean().optional().describe("Also search the shared cortex://global mesh."),
      explain: z.boolean().optional().describe("Include per-node match reasons, for debugging a miss."),
    },
  },
  async ({ query, uri, token_budget, include_mesh, explain }) => {
    try {
      const data = await core("/v1/recall", {
        body: {
          owner: uri || OWNER,
          prompt: query,
          token_budget: token_budget ?? TOKEN_BUDGET,
          include_mesh: include_mesh ?? INCLUDE_MESH,
          explain: explain ?? false,
        },
      });
      const payload = { recall: summarizeRecall(data) };
      if (explain && Array.isArray(data.debug) && data.debug.length) {
        payload.debug = data.debug.slice(0, 12).map((d) => ({
          label: d.node?.label,
          score: Number((d.score ?? 0).toFixed(3)),
          why: d.why,
        }));
      }
      return text(payload);
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_remember",
  {
    title: "Remember a fact",
    description:
      "Store a durable fact, preference, architectural decision or rule so future sessions inherit it. Good: 'uses pnpm, not npm', 'API must stay backwards compatible', 'lives in Berlin'. Bad: secrets, transient state, verbatim chat logs.",
    inputSchema: {
      fact: z.string().min(3).describe("One atomic statement in the user's own terms, e.g. 'User prefers Postgres for relational data'."),
      uri: z.string().optional().describe("Namespace to store under, e.g. cortex://team_eng. Defaults to CORTEX_OWNER."),
      impact: z.number().int().min(0).max(10).optional().describe("How permanent: 10 identity/medical/never-change, 5 preference, 1 situational."),
    },
  },
  async ({ fact, uri, impact }) => {
    try {
      const lines = String(fact)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith("USER:") ? l : `USER: ${l}`))
        .join("\n");
      const body = { owner: uri || OWNER, prompt: lines, source: "mcp", wait: true };
      // A floor, not a replacement: an identity fact the model already scored
      // 10 stays at 10.
      if (Number.isInteger(impact)) body.impact = Math.min(10, Math.max(0, impact));
      const data = await core("/v1/ingest", { body });
      const report = data.result ?? {};
      const stored = (report.triplets_extracted ?? 0) > 0;
      const notes = [];
      if (Array.isArray(report.warnings) && report.warnings.length) notes.push(...report.warnings);
      if (!stored) {
        return text({
          remembered: false,
          message:
            "Nothing was stored: the extractor found no durable triplet in that text. " +
            "Try one atomic sentence, e.g. 'User prefers Rust over Go for backend services'.",
          warnings: notes,
        });
      }
      return text({
        remembered: true,
        owner: report.owner_uri || uri || OWNER,
        triplets: report.triplets_extracted,
        new_nodes: report.nodes_new,
        new_edges: report.edges_new,
        extractor: report.extractor,
        warnings: notes.length ? notes : undefined,
        message: `Remembered under ${report.owner_uri || uri || OWNER}.`,
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_remember_turn",
  {
    title: "Buffer a conversation turn",
    description:
      "Append one turn (user or assistant) to a session buffer. The core extracts facts when the session goes idle or is flushed, so a whole conversation costs one extraction pass. Use for ongoing work; use cortex_remember for single explicit facts.",
    inputSchema: {
      session_id: z.string().min(1).max(128).describe("Stable id per conversation/thread, e.g. the Cursor chat id."),
      role: z.enum(["user", "assistant", "system", "tool"]).describe("Who is speaking. Only user turns become facts."),
      content: z.string().min(1).describe("The turn text."),
      uri: z.string().optional().describe("Owner namespace. Defaults to CORTEX_OWNER."),
      flush_now: z.boolean().optional().describe("Extract immediately instead of waiting for the idle window."),
    },
  },
  async ({ session_id, role, content, uri, flush_now }) => {
    try {
      const buffered = await core("/v1/session/message", {
        body: { session_id, role, content, owner: uri || OWNER, source: "mcp" },
      });
      if (!flush_now) return text({ buffered: true, session_id, idle_flush_secs: buffered.idle_flush_secs });
      const flush = await core("/v1/flush", { body: { session_id } });
      const report = (flush.results ?? [])[0] ?? {};
      return text({
        buffered: false,
        session_id,
        triplets: report.triplets_extracted ?? 0,
        new_nodes: report.nodes_new ?? 0,
        warnings: report.warnings,
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_resolve",
  {
    title: "Resolve a cortex:// URI",
    description:
      "Read a whole memory namespace (person, project, team) as a JSON-LD context packet. Use when the user names a namespace rather than asking a question.",
    inputSchema: {
      uri: z.string().describe("e.g. cortex://user_123, cortex://team_eng, cortex://global"),
      token_budget: z.number().int().min(32).max(8000).optional(),
      include_mesh: z.boolean().optional(),
    },
  },
  async ({ uri, token_budget, include_mesh }) => {
    try {
      if (!/^cortex:\/\/[\w:.\-]{1,128}$/.test(uri)) {
        return text({
          error: "uri must look like cortex://team_eng (lowercase slug of 1-128 chars).",
        });
      }
      const packet = await core("/v1/resolve", {
        method: "GET",
        query: {
          uri,
          token_budget: token_budget ?? TOKEN_BUDGET,
          include_mesh: include_mesh ?? INCLUDE_MESH,
        },
      });
      return text({
        uri,
        memories_found: packet.memories_found,
        truncated: packet.truncated,
        briefing: packet.briefing,
        nodes: (packet.nodes ?? []).slice(0, 40).map((n) => ({ label: n.label, category: n.category, impact: n.impact })),
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_forget",
  {
    title: "Forget a memory",
    description:
      "Delete one memory node and the edges that referenced it. Use when the user says something is wrong, outdated, or they no longer want it remembered. Ask before bulk deletions.",
    inputSchema: {
      node_id: z.string().optional().describe("Node id from a recall result (takes precedence when both are given)."),
      label: z.string().optional().describe("Exact label, e.g. 'MongoDB'."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ node_id, label }) => {
    try {
      if (!node_id && !label) return text({ error: "provide node_id or label" });
      let id = node_id;
      if (!id) {
        const found = await core("/v1/memories", { method: "GET", query: { owner: OWNER, q: label, limit: 20 } });
        const match = (found.memories ?? []).find((m) => (m.label || "").toLowerCase() === String(label).toLowerCase())
          ?? (found.memories ?? [])[0];
        if (!match) return text({ deleted: false, message: `no memory labelled "${label}" under ${OWNER}` });
        id = match.id;
      }
      const result = await core(`/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      return text({ deleted: true, id, note: result?.message, message: "Forgotten, along with its edges. This cannot be undone." });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_lock",
  {
    title: "Protect a memory from forgetting",
    description:
      "Pin or unpin a memory so the decay sweep can never fade or prune it. Use for permanent identity facts and hard project rules the user asked to keep forever.",
    inputSchema: {
      node_id: z.string().optional().describe("Node id to lock or unlock (takes precedence over label)."),
      label: z.string().optional().describe("Exact memory label, e.g. 'use pnpm in CI', when the id is unknown."),
      locked: z.boolean().default(true).describe("true = protected from decay, false = allow it to fade normally."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ node_id, label, locked }) => {
    try {
      if (!node_id && !label) return fail(new CoreError("provide node_id or label", { code: "bad_request" }));
      const node = await findNode({ node_id, label });
      if (!node) return text({ locked: false, message: `no memory labelled "${label}" under ${OWNER}` });
      const result = await core(`/v1/memories/${encodeURIComponent(node.id)}/lock`, { body: { locked } });
      return text({
        locked: result.locked ?? !!locked,
        id: node.id,
        label: result.label ?? node.label,
        note: locked
          ? "Exempt from decay from now on; recall always keeps it within budget."
          : "Decay can fade this again. It is not deleted, only deprioritised.",
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_expand",
  {
    title: "Expand a memory",
    description:
      "Return one memory plus the edges and neighbouring memories that connect to it — the local graph around a concept. Use after a recall names something whose relationships matter (a dependency, a superseded choice, a rule that points at another rule).",
    inputSchema: {
      node_id: z.string().optional().describe("Node id from a recall result."),
      label: z.string().optional().describe("Exact memory label when the id is unknown."),
      uri: z.string().optional().describe("Namespace to read, e.g. cortex://team_eng."),
      max_neighbours: z.number().int().min(1).max(60).optional().describe("How many neighbours to include (default 12)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ node_id, label, uri, max_neighbours }) => {
    try {
      if (!node_id && !label) return fail(new CoreError("provide node_id or label", { code: "bad_request" }));
      const owner = uri || OWNER;
      const node = await findNode({ node_id, label, uri: owner });
      if (!node) return text({ found: false, message: `no memory matched "${label}" in ${owner}` });
      // One page of the graph, adjacency computed locally: the core exposes the
      // node list and its edges, which is everything a neighbourhood needs.
      const list = await core("/v1/memories", { method: "GET", query: { owner, limit: 2000, include_mesh: includeMeshFor(uri) } });
      const byId = new Map((list.memories ?? []).map((n) => [n.id, n]));
      const touching = (list.edges ?? []).filter((e) => e.source === node.id || e.target === node.id);
      const limit = max_neighbours ?? 12;
      const neighbours = [];
      for (const edge of touching) {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = byId.get(otherId);
        neighbours.push({
          relation: edge.source === node.id ? edge.predicate : `${edge.predicate} (reverse)`,
          weight: edge.weight,
          historical: !!edge.is_historical,
          memory: other
            ? { id: other.id, label: other.label, impact: other.impact, retention: Number((other.retention ?? 0).toFixed(3)), locked: !!other.locked }
            : { id: otherId, label: "(outside the returned page)" },
        });
        if (neighbours.length >= limit) break;
      }
      const merged = new Map();
      for (const item of neighbours) merged.set(item.memory.id, item);
      return text({
        found: true,
        memory: byId.get(node.id) ?? node,
        edges: touching.length,
        truncated_by_page: (list.total ?? 0) > (list.returned ?? 0),
        neighbours: [...merged.values()],
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_ingest_project_files",
  {
    title: "Ingest project files",
    description:
      "Read text/code files under the configured CORTEX_READ_DIRS allowlist and store the durable conventions they encode (AGENTS.md, README, package manifests, config). Never reads outside the allowlist and never reads binaries. Nothing is uploaded anywhere: files go to the local core.",
    inputSchema: {
      globs: z
        .array(z.string())
        .optional()
        .describe("File names to look for. Defaults to AGENTS.md, CLAUDE.md, README.md, package.json, pyproject.toml, Cargo.toml, tsconfig.json, .editorconfig."),
      max_files: z.number().int().min(1).max(50).optional().describe("Safety cap on files read (default 12)."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ globs, max_files }) => {
    try {
      if (!READ_DIRS.length) {
        return text({
          ingested: 0,
          message:
            "Refusing to read files: set CORTEX_READ_DIRS to a colon-separated allowlist of directories in the MCP server env (e.g. \"/home/me/dev/app\").",
        });
      }
      const wanted = (globs && globs.length ? globs : DEFAULT_FILE_NAMES).filter(isPlainFileName);
      const maxFiles = clampInt(max_files, 12, 1, 50);
      const collected = [];
      for (const root of READ_DIRS) {
        for (const name of wanted) {
          if (collected.length >= maxFiles) break;
          const file = await resolveAllowed(root, name);
          if (file) collected.push(file);
        }
      }
      if (!collected.length) {
        return text({ ingested: 0, message: `No readable files matched ${wanted.join(", ")} under ${READ_DIRS.join(", ")}.` });
      }

      let triplets = 0, nodes = 0, edges = 0;
      const files = [];
      for (const { file, label, bytes } of collected) {
        const data = await core("/v1/ingest", {
          body: { owner: OWNER, prompt: `Project context from ${label}:\n\n${bytes}`, source: "files", wait: true },
        });
        const report = data.result ?? {};
        triplets += report.triplets_extracted ?? 0;
        nodes += report.nodes_new ?? 0;
        edges += report.edges_new ?? 0;
        files.push({ file: label, triplets: report.triplets_extracted ?? 0 });
      }
      return text({
        ingested: collected.length,
        files,
        triplets,
        new_nodes: nodes,
        new_edges: edges,
        message: `Read ${collected.length} file(s) from the allowlist; ${triplets} durable triplet(s) extracted.`,
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "cortex_status",
  {
    title: "Core status",
    description:
      "Report whether the CORTEX core is reachable, which backend it uses, how many memories exist and what the client configuration resolved to. Use for any 'memory seems broken / empty' report from the user.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const report = { core_url: CORE_URL, owner: OWNER, token_budget: TOKEN_BUDGET, auth: API_KEY ? "key configured" : "no key (loopback only)" };
    try {
      const health = await core("/health", { method: "GET" });
      const stats = await core("/v1/stats", { method: "GET" });
      return text({ ...report, reachable: true, health, stats });
    } catch (error) {
      return text({ ...report, reachable: false, error: error.message });
    }
  }
);

function includeMeshFor(uri) {
  return uri && uri !== OWNER ? true : INCLUDE_MESH;
}

function isPlainFileName(name) {
  return typeof name === "string" && !name.includes("/") && !name.includes("\\") && !name.includes("..") && name.length <= 64;
}

/** Realpath-validated read inside the allowlist: symlinks and `..` cannot escape. */
async function resolveAllowed(root, name) {
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return null;
  }
  const candidate = path.resolve(realRoot, name);
  let realFile;
  try {
    realFile = await fs.realpath(candidate);
  } catch {
    return null;
  }
  if (realFile !== candidate && !realFile.startsWith(realRoot + path.sep)) return null;
  const stat = await fs.stat(realFile);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  if (!CODE_EXTS.has(path.extname(realFile).toLowerCase()) && path.extname(realFile) !== "") return null;
  const raw = await fs.readFile(realFile, "utf8");
  const bytes = raw.replace(/(?:\b(?:sk|pk|ghp|xoxb|AKIA)[A-Za-z0-9_\-]{12,}\b)/g, "[redacted]").slice(0, MAX_FILE_BYTES);
  return { file: realFile, label: `${path.basename(realRoot)}/${name}`, bytes };
}

// Resources: cheap, deterministic context for clients that preload them.
server.registerResource(
  "cortex-profile",
  "cortex://profile",
  {
    title: "CORTEX profile",
    description: "The strongest memories in the configured namespace, for always-on context.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const body = summarizeRecall(
      await core("/v1/recall", { body: { owner: OWNER, prompt: "identity, preferences, rules, stack, project", token_budget: TOKEN_BUDGET } })
    );
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text: body }] };
  }
);

server.registerResource(
  "cortex-stats",
  "cortex://stats",
  { title: "CORTEX core stats", description: "Backend, counts and decay policy.", mimeType: "application/json" },
  async (uri) => {
    const stats = await core("/v1/stats", { method: "GET" });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(stats, null, 2) }] };
  }
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the JSON-RPC channel.
  const health = await core("/health", { method: "GET" }).catch(() => null);
  if (!health) {
    process.stderr.write(`[cortex-mcp] core not reachable at ${CORE_URL}. ${START_HINT}\n`);
  } else {
    process.stderr.write(
      `[cortex-mcp] ready · core=${CORE_URL} backend=${health.backend ?? "?"} owner=${OWNER} budget=${TOKEN_BUDGET} mesh=${INCLUDE_MESH ? "on" : "off"}\n`
    );
  }
}

run().catch((error) => {
  process.stderr.write(`[cortex-mcp] fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});
