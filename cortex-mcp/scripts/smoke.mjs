#!/usr/bin/env node
/**
 * End-to-end smoke test for the MCP server.
 *
 * Spawns a stub CORTEX core that speaks the real HTTP contract, drives the MCP
 * server over stdio exactly like Cursor does, and asserts on the tool results —
 * including the failure paths, which is where this server used to lie.
 *
 *   node scripts/smoke.mjs        # or: npm run smoke
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const PORT = 3939;
const OWNER = "cortex://smoke";

// ---------------------------------------------------------------------------
// Stub core: mirrors cortex-core's routes and error shapes closely enough that
// a contract break on either side shows up here.
// ---------------------------------------------------------------------------

const nodes = new Map();
const edges = new Map();
const sessions = new Map();
let requests = 0;
function coreAuthOk() {
  return true;
}

function canonical(label) {
  const key = String(label).trim().toLowerCase().replace(/\s+/g, " ");
  return `node:${key}`;
}

function extract(prompt) {
  const out = [];
  for (const line of String(prompt).split(/\r?\n/)) {
    if (!/^USER:/i.test(line.trim())) continue;
    const body = line.trim().replace(/^USER:\s*/i, "");
    const m = body.match(/i (?:prefer|like|use|uses)\s+(.+?)(?:\s+over\s+.+)?[.!?]?$/i)
      || body.match(/^always\s+(.+?)[.!?]?$/i)
      || body.match(/^never\s+(.+?)[.!?]?$/i);
    if (!m) continue;
    const predicate = /^always/i.test(body) ? "must" : /^never/i.test(body) ? "must_not" : "prefers";
    out.push({
      subject: "User",
      predicate,
      object: m[1].trim().replace(/[.;,]+$/, ""),
      confidence: 0.9,
      impact: predicate === "prefers" ? 7 : 10,
      overwrite: false,
    });
  }
  return out;
}

function applyTriplets(triplets, owner, provenance, floor) {
  let newNodes = 0;
  let newEdges = 0;
  for (const t of triplets) {
    for (const label of [t.subject, t.object]) {
      const id = canonical(label);
      if (!nodes.has(id)) {
        newNodes += 1;
        nodes.set(id, { id, key: id, label, category: "concept", impact: t.impact, stability: 1, locked: false, fading: false, retention: 1, owner_uri: owner, provenance, access_count: 0 });
      }
    }
    const src = canonical(t.subject);
    const tgt = canonical(t.object);
    const id = `edge:${src}->${t.predicate}->${tgt}`;
    if (!edges.has(id)) {
      newEdges += 1;
      edges.set(id, { id, source: src, target: tgt, predicate: t.predicate, weight: 0.9, is_historical: false, impact: Math.max(t.impact, floor ?? 0), owner_uri: owner, provenance });
    }
  }
  return { newNodes, newEdges };
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  requests += 1;
  void coreAuthOk(req);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer smoke-key") {
      return json(res, 401, { error: { code: "unauthorized", message: "missing bearer token" } });
    }
    const body = raw ? JSON.parse(raw) : {};

    if (url.pathname === "/health") {
      return json(res, 200, {
        status: "ok",
        version: "smoke",
        uptime_secs: 12,
        backend: "file",
        decay_policy: "soft",
        authenticated: true,
        services: { graph: true, extraction: false, vector_accelerator: false, sessions: true, cloud_sync: false },
        counts: { nodes: nodes.size, edges: edges.size, pending_jobs: 0, buffered_sessions: sessions.size },
      });
    }
    if (url.pathname === "/v1/stats") {
      return json(res, 200, { version: "smoke", backend: "file", decay_policy: "soft", nodes: nodes.size, edges: edges.size, locked: 0, fading: 0, historical: 0, avg_retention: 1, by_category: {}, by_provenance: {}, top_labels: [...nodes.values()].slice(0, 5).map((n) => n.label), full_graph_token_estimate: nodes.size * 12 });
    }
    if (url.pathname === "/v1/recall" && req.method === "POST") {
      const owner = body.owner || OWNER;
      const hits = [...nodes.values()].filter((n) => n.owner_uri === owner);
      if (!hits.length) {
        return json(res, 200, { briefing: "", token_budget: body.token_budget ?? 500, tokens_used: 0, memories_found: 0, truncated: false, scanned: 0, owner_uri: owner, node_count: 0, edge_count: 0, nodes: [], edges: [] });
      }
      const lines = hits.map((n) => `- ${n.label} (impact ${n.impact})`);
      const used = Math.max(1, Math.round(lines.join("\n").length / 4));
      return json(res, 200, {
        briefing: `## Established facts\n${lines.join("\n")}`,
        token_budget: body.token_budget ?? 500,
        tokens_used: used,
        memories_found: hits.length,
        truncated: used > (body.token_budget ?? 500),
        scanned: hits.length,
        owner_uri: owner,
        node_count: hits.length,
        edge_count: edges.size,
        nodes: hits,
        edges: [...edges.values()],
        debug: body.explain ? hits.map((n) => ({ node: n, score: 0.5, why: ["label_token_match"] })) : undefined,
      });
    }
    if (url.pathname === "/v1/ingest" && req.method === "POST") {
      const owner = body.owner || "cortex://default";
      const triplets = extract(body.prompt || "");
      const { newNodes, newEdges } = applyTriplets(triplets, owner, body.source || "api", body.impact);
      return json(res, 200, {
        accepted: true,
        job_id: "job:smoke",
        result: {
          triplets_extracted: triplets.length,
          triplets_rejected: 0,
          nodes_upserted: triplets.length * 2,
          nodes_new: newNodes,
          edges_upserted: triplets.length,
          edges_new: newEdges,
          extractor: "stub",
          warnings: [],
          owner_uri: owner,
        },
      });
    }
    if (url.pathname === "/v1/session/message" && req.method === "POST") {
      const list = sessions.get(body.session_id) || [];
      list.push(body);
      sessions.set(body.session_id, list);
      return json(res, 200, { buffered: true, session_id: body.session_id, idle_flush_secs: 90, flush: null });
    }
    if (url.pathname === "/v1/flush" && req.method === "POST") {
      const list = sessions.get(body.session_id) || [];
      sessions.delete(body.session_id);
      const prompt = list.map((m) => (m.role === "user" ? `USER: ${m.content}` : `ASSISTANT: ${m.content}`)).join("\n");
      const triplets = extract(prompt);
      const { newNodes, newEdges } = applyTriplets(triplets, OWNER, "session", null);
      return json(res, 200, { flushed_sessions: 1, results: [{ triplets_extracted: triplets.length, nodes_new: newNodes, edges_new: newEdges, warnings: [], owner_uri: OWNER }] });
    }
    if (url.pathname === "/v1/memories" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      let list = [...nodes.values()].filter((n) => n.owner_uri === (url.searchParams.get("owner") || OWNER));
      if (q) list = list.filter((n) => n.label.toLowerCase().includes(q));
      // The real handler returns the edges between the returned nodes, which is
      // what makes neighbourhood expansion possible without a graph query.
      const ids = new Set(list.map((n) => n.id));
      const pageEdges = [...edges.values()].filter((e) => ids.has(e.source) && ids.has(e.target));
      return json(res, 200, { owner_uri: OWNER, total: list.length, returned: list.length, memories: list, edges: pageEdges });
    }
    const del = url.pathname.match(/^\/v1\/memories\/(.+)$/);
    if (del && req.method === "DELETE") {
      const id = decodeURIComponent(del[1]);
      const found = nodes.delete(id);
      if (!found) return json(res, 404, { error: { code: "not_found", message: `no memory ${id}` } });
      for (const [eid, e] of edges) if (e.source === id || e.target === id) edges.delete(eid);
      return json(res, 204, "");
    }
    const lock = url.pathname.match(/^\/v1\/memories\/(.+)\/lock$/);
    if (lock && req.method === "POST") {
      const id = decodeURIComponent(lock[1]);
      const node = nodes.get(id);
      if (!node) return json(res, 404, { error: { code: "not_found", message: `no memory ${id}` } });
      node.locked = !!body.locked;
      return json(res, 200, { id, label: node.label, locked: node.locked });
    }
    if (url.pathname === "/v1/mesh/publish") {
      return json(res, 501, { error: { code: "mesh_publish_disabled", message: "mesh publishing is disabled" } });
    }
    return json(res, 404, { error: { code: "not_found", message: `no route ${url.pathname}` } });
  });
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

// ---------------------------------------------------------------------------
// MCP client over stdio
// ---------------------------------------------------------------------------

const child = spawn(process.execPath, [path.join(PKG, "index.js")], {
  cwd: PKG,
  env: {
    ...process.env,
    CORTEX_API_URL: `http://127.0.0.1:${PORT}`,
    CORTEX_API_KEY: "smoke-key",
    CORTEX_OWNER: OWNER,
    CORTEX_READ_DIRS: path.resolve(PKG, ".."),
    CORTEX_MAX_FILE_BYTES: "40000",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderrText = "";
child.stderr.on("data", (chunk) => (stderrText += chunk.toString()));

const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  }
});

/** Minimal JSON-RPC client so the same script can drive a second server. */
function attach(child) {
  const queue = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let index;
    while ((index = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, index).trim();
      buf = buf.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = queue.get(message.id);
      if (waiter) {
        queue.delete(message.id);
        waiter(message);
      }
    }
  });
  return { child, queue, nextId: 1 };
}

function rpcCall(client, method, params) {
  const id = client.nextId++;
  return new Promise((resolve, reject) => {
    client.queue.set(id, resolve);
    client.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (client.queue.delete(id)) reject(new Error(`${method} timed out`));
    }, 15000);
  });
}

async function spawnClient(apiKey) {
  const child = spawn(process.execPath, [path.join(PKG, "index.js")], {
    cwd: PKG,
    env: { ...process.env, CORTEX_API_URL: `http://127.0.0.1:${PORT}`, CORTEX_API_KEY: apiKey, CORTEX_OWNER: OWNER },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = attach(child);
  await rpcCall(client, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-auth", version: "0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return client;
}

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 15000);
  });
}

function payload(result) {
  const payload = result?.result ?? result;
  const item = payload?.content?.[0];
  const value = item?.text ?? "";
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const checks = [];
function assert(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
}

// handshake
await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await call("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
assert("every tool is registered", names.length >= 9, names);
assert("a destructive tool is marked destructive", tools.result.tools.find((t) => t.name === "cortex_forget").annotations?.destructiveHint === true, names);
assert("tools carry descriptions the model can act on", tools.result.tools.every((t) => (t.description || "").length > 40), names);
assert("recall is described as a pre-answer step", /before answering/i.test(tools.result.tools.find((t) => t.name === "cortex_recall").description));

const resources = await call("resources/list", {});
assert("profile resource is advertised", resources.result.resources.some((r) => r.uri === "cortex://profile"), resources.result);

// empty brain: must be honest, not a fake hit
let result = await call("tools/call", { name: "cortex_recall", arguments: { query: "which database do I use" } });
let value = payload(result);
assert("empty recall says there is nothing (and stays a success)", /No relevant memories found/.test(String(value.recall ?? value)) && !result.result?.isError, value);

// remember -> the core reports what was extracted
result = await call("tools/call", { name: "cortex_remember", arguments: { fact: "I prefer Postgres over MySQL", impact: 9 } });
value = payload(result);
assert("remember reports what it stored", value.remembered === true && value.triplets === 1, value);

result = await call("tools/call", { name: "cortex_remember", arguments: { fact: "hmm let me think about that a bit" } });
value = payload(result);
assert("remember admits when nothing was stored", value.remembered === false, value);

// recall now finds it, by label
result = await call("tools/call", { name: "cortex_recall", arguments: { query: "database choice", explain: true } });
value = payload(result);
assert("recall returns the stored fact", /Postgres/.test(String(value.recall ?? value)), value);
assert("recall never leaks raw ids into the briefing", !/node:/.test(String(value.recall ?? value)), value);
assert("explain mode returns reasons", Array.isArray(value.debug) && value.debug.length > 0, value);

// turn buffering + explicit flush
result = await call("tools/call", { name: "cortex_remember_turn", arguments: { session_id: "s1", role: "assistant", content: "I use Mongo everywhere" } });
value = payload(result);
assert("assistant turns are buffered only", value.buffered === true, value);

result = await call("tools/call", { name: "cortex_remember_turn", arguments: { session_id: "s1", role: "user", content: "never use raw SQL strings", flush_now: true } });
value = payload(result);
assert("flush_now extracts immediately", value.triplets >= 1, value);

// forget by label
result = await call("tools/call", { name: "cortex_forget", arguments: { label: "Postgres" } });
value = payload(result);
assert("forget deletes by label", value.deleted === true, value);

result = await call("tools/call", { name: "cortex_forget", arguments: { label: "does-not-exist-at-all" } });
value = payload(result);
assert("forget reports a miss instead of claiming success", value.deleted === false, value);

// file allowlist
result = await call("tools/call", { name: "cortex_ingest_project_files", arguments: { globs: ["AGENTS.md", "package.json"], max_files: 3 } });
value = payload(result);
assert("file ingest reads inside the allowlist", value.ingested >= 1, value);

result = await call("tools/call", { name: "cortex_ingest_project_files", arguments: { globs: ["../../../etc/passwd"] } });
value = payload(result);
assert("traversal attempts are dropped, not read", value.ingested === undefined || value.ingested === 0, value);

// status + honest mesh refusal
// A fact created for this check, so it does not depend on another assertion's leftovers.
result = await call("tools/call", { name: "cortex_remember", arguments: { fact: "always use pnpm in CI", impact: 10 } });
value = payload(result);
assert("an explicit rule is remembered", value.remembered === true, value);

result = await call("tools/call", { name: "cortex_lock", arguments: { label: "use pnpm in CI", locked: true } });
value = payload(result);
assert("lock accepts a label, not only an id", value.locked === true && value.id === "node:use pnpm in ci", value);

result = await call("tools/call", { name: "cortex_lock", arguments: { label: "does-not-exist-at-all" } });
value = payload(result);
assert("lock on a miss says so without touching anything", value.locked === false && /no memory/i.test(String(value.message)), value);

result = await call("tools/call", { name: "cortex_lock", arguments: { node_id: "node:not-real" } });
value = result?.result ?? result;
assert("locking an invented id surfaces the core's 404", value.isError === true && /not_found/.test(JSON.stringify(value)), value);

result = await call("tools/call", { name: "cortex_expand", arguments: { label: "User" } });
value = payload(result);
assert(
  "expand returns the neighbourhood around a memory",
  value.found === true && Array.isArray(value.neighbours) && value.neighbours.length >= 1 && value.memory?.label === "User",
  value
);

result = await call("tools/call", { name: "cortex_expand", arguments: {} });
value = result?.result ?? result;
assert("expand refuses to guess a target", value.isError === true && /node_id or label/.test(JSON.stringify(value)), value);

result = await call("tools/call", { name: "cortex_status", arguments: {} });
value = payload(result);
assert("status reports reachability and config", value.reachable === true && value.core_url.includes(String(PORT)), value);

// auth rejection must surface as an MCP error with an actionable hint
const badChild = await spawnClient("wrong-key");
const badResult = await rpcCall(badChild, "tools/call", { name: "cortex_recall", arguments: { query: "x" } });
const badValue = badResult.result ?? badResult;
assert(
  "a rejected key is an MCP error that says how to fix it",
  badValue.isError === true && /unauthorized/i.test(badValue.content[0].text) && /CORTEX_API_KEY/.test(badValue.content[0].text),
  badValue
);
badChild.child.kill("SIGKILL");

// kill the core: the tool must return isError
server.close();
await new Promise((r) => setTimeout(r, 150));
result = await call("tools/call", { name: "cortex_recall", arguments: { query: "anything" } }).catch((e) => ({ error: e.message }));
value = result?.result ?? result;
assert("core down yields isError, not fake context", value.isError === true || /unreachable/.test(JSON.stringify(value)), value);

// stdin close: the server must exit rather than hang
child.stdin.end();
const exit = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve("timeout"), 4000);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});
assert("exits cleanly when the client disconnects", exit === 0, exit);
assert("no secrets in the startup banner", !/smoke-key/.test(stderrText), stderrText.slice(0, 200));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
child.kill("SIGKILL");
process.exit(failed.length ? 1 : 0);
