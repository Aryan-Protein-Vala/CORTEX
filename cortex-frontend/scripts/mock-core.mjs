/**
 * Dev-only stub of the CORTEX core (`node scripts/mock-core.mjs`), so the
 * dashboard can be worked on without cargo. It answers the routes /api/core
 * proxies and uses the real response keys; the Rust contract tests in
 * cortex-core/tests/api_contract.rs are the source of truth for those shapes.
 */
import http from "node:http";
import fs from "node:fs";
const log = { requests: [] };
const nodes = [
  { id: "node:pnpm", label: "use pnpm in CI", category: "rule", impact: 9, stability: 1.4, weight_hint: 0.9, locked: true, fading: false, retention: 1, owner_uri: "cortex://default", provenance: "extension", access_count: 4, last_accessed: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "node:tailwind", label: "Tailwind v4", category: "concept", impact: 6, stability: 1, weight_hint: 0.7, locked: false, fading: true, retention: 0.31, owner_uri: "cortex://default", provenance: "mcp", access_count: 1, last_accessed: new Date().toISOString(), updated_at: new Date().toISOString() },
];
const edges = [{ id: "edge:x", source: "node:pnpm", target: "node:tailwind", predicate: "relates_to", weight: 0.8, is_historical: false, impact: 5, locked: false }];
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    log.requests.push({ url: req.url, method: req.method, key: req.headers["x-cortex-key"] ?? null, auth: req.headers.authorization ?? null, body: body || null });
    fs.writeFileSync(process.env.CORTEX_MOCK_LOG ?? "mock-core-requests.json", JSON.stringify(log, null, 2));
    const json = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith("/health")) return json({ status: "ok", version: "0.1.0", uptime_secs: 42, backend: "file", decay_policy: "soft", authenticated: true, services: { graph: true, extraction: false, vector_accelerator: false, sessions: true, cloud_sync: false }, counts: { nodes: nodes.length, edges: edges.length, pending_jobs: 0, buffered_sessions: 1 } });
    if (req.url.startsWith("/v1/stats")) return json({ version: "0.1.0", backend: "file", decay_policy: "soft", nodes: nodes.length, edges: edges.length, locked: 1, fading: 1, historical: 0, avg_retention: 0.655, by_category: { rule: 1, concept: 1 }, by_provenance: { extension: 1, mcp: 1 }, top_labels: ["use pnpm in CI", "Tailwind v4"], full_graph_token_estimate: 22 });
    if (req.url.startsWith("/v1/memories")) return json({ owner_uri: "cortex://default", total: nodes.length, returned: nodes.length, memories: nodes, edges });
    if (req.url.startsWith("/v1/recall")) return json({ briefing: "[memory] use pnpm in CI (impact 9, locked)", token_budget: 400, tokens_used: 11, memories_found: 1, truncated: false, scanned: 2, owner_uri: "cortex://default", node_count: 1, edge_count: 0, nodes: [nodes[0]], edges: [] });
    if (req.url.startsWith("/v1/sweep")) return json({ policy: "soft", evaluated_nodes: 2, evaluated_edges: 1, faded_nodes: 1, depressed_edges: 0, pruned_nodes: 0, pruned_edges: 0, protected_nodes: 1 });
    if (req.url.startsWith("/v1/ingest")) return json({ accepted: true, job_id: "job_9", result: { triplets_extracted: 1, triplets_rejected: 0, nodes_upserted: 1, nodes_new: 1, edges_upserted: 0, edges_new: 0, extractor: "heuristics", warnings: [], owner_uri: "cortex://default" } }, 202);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: `no route ${req.url}` } }));
  });
}).listen(3941, "127.0.0.1", () => console.error("mock core on 3941"));
