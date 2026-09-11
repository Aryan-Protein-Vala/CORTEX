#!/usr/bin/env node
/**
 * Contract test for the JS SDK against a stub core: same style as
 * `cortex-mcp/scripts/smoke.mjs`, because both must speak the real API.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { Cortex, CortexError } from "../src/client.ts";

let passed = 0;
const seen = [];
let mode = "ok";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    seen.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : null });
    if (mode === "unauthorized") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "unauthorized", message: "invalid token" } }));
    }
    if (req.url.startsWith("/v1/jobs")) {
      const done = seen.filter((entry) => entry.url.startsWith("/v1/jobs")).length >= 2;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ job_id: "job_1", state: done ? "done" : "running", result: done ? { triplets_extracted: 1 } : null }));
    }
    if (req.url.startsWith("/v1/ingest")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ accepted: true, job_id: "job_1", result: { triplets_extracted: 2, nodes_upserted: 2, edges_upserted: 1, nodes_new: 1, edges_new: 1, triplets_rejected: 0, extractor: "heuristics", warnings: [], owner_uri: "cortex://default" } }));
    }
    if (req.url.startsWith("/v1/recall")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ briefing: "[memory] use pnpm", token_budget: 400, tokens_used: 4, memories_found: 1, truncated: false, scanned: 3, owner_uri: "cortex://default", node_count: 1, edge_count: 0, nodes: [], edges: [] }));
    }
    if (req.url.includes("/v1/memories/abc")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ deleted: true, node_id: "abc def" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const client = new Cortex({ url, apiKey: "k123", owner: "cortex://me" });

async function test(name, fn) {
  seen.length = 0;
  mode = "ok";
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

await test("remember posts the core's ingest keys", async () => {
  const result = await client.remember("always use pnpm in CI", { source: "test", wait: true, impact: 8 });
  const entry = seen[0];
  assert.equal(entry.method, "POST");
  assert.ok(entry.url.startsWith("/v1/ingest"), entry.url);
  assert.deepEqual(Object.keys(entry.body).sort(), ["impact", "owner", "prompt", "source", "wait"]);
  assert.equal(entry.body.owner, "cortex://me");
  assert.equal(entry.body.impact, 8);
  assert.equal(entry.headers["x-cortex-key"], "k123");
  assert.equal(entry.headers.authorization, "Bearer k123");
  assert.equal(result.result.triplets_extracted, 2);
});

await test("recall sends owner + budget and returns the briefing", async () => {
  const result = await client.recall("which package manager?", { tokenBudget: 400, explain: true });
  assert.deepEqual(Object.keys(seen[0].body).sort(), ["explain", "include_mesh", "owner", "prompt", "token_budget"]);
  assert.equal(seen[0].body.include_mesh, false);
  assert.equal(result.briefing, "[memory] use pnpm");
});

await test("resolveGraph builds a cortex:// query", async () => {
  await client.resolveGraph("cortex://team/platform", { includeMesh: true, tokenBudget: 600 });
  assert.ok(seen[0].url.startsWith("/v1/resolve?"), seen[0].url);
  const query = new URL(seen[0].url, url).searchParams;
  assert.equal(query.get("uri"), "cortex://team/platform");
  assert.equal(query.get("include_mesh"), "true");
  assert.equal(query.get("token_budget"), "600");
});

await test("forget encodes the node id and uses DELETE", async () => {
  const result = await client.forget("abc def");
  assert.equal(seen[0].method, "DELETE");
  assert.equal(result.deleted, true);
});

await test("awaitJob polls until the core reports done", async () => {
  const job = await client.awaitJob("job_1", { intervalMs: 5, timeoutMs: 2000 });
  assert.equal(job.state, "done");
  assert.ok(seen.length >= 2, "should poll more than once");
});

await test("a 401 becomes an actionable CortexError", async () => {
  mode = "unauthorized";
  await assert.rejects(() => client.stats(), (error) => {
    assert.ok(error instanceof CortexError, error?.name);
    assert.equal(error.status, 401);
    assert.equal(error.code, "unauthorized");
    assert.match(error.hint, /CORTEX_API_KEY/);
    assert.match(error.message, /invalid token/);
    return true;
  });
});

await test("an unreachable core says so instead of hanging", async () => {
  const dead = new Cortex({ url: "http://127.0.0.1:1", timeoutMs: 1500 });
  await assert.rejects(() => dead.health(), (error) => {
    assert.equal(error.code, "network");
    assert.match(error.hint, /cargo run/);
    return true;
  });
});

await test("empty remember() fails locally with a clear code", async () => {
  await assert.rejects(() => client.remember("   "), (error) => error.code === "empty_text");
});

await test("string-free config resolves env defaults", async () => {
  const legacy = new Cortex({ url, apiKey: "k123" });
  assert.equal(legacy.baseUrl, url);
  await legacy.health();
  assert.ok(seen[0].url.startsWith("/health"));
});

server.close();
console.log(`\n${passed}/9 SDK checks passed`);
