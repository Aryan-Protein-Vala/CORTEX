# CORTEX Core — HTTP API

Written against the structs in `src/api/server.rs` and `src/types/mod.rs`, not from memory: the
MCP server, `cortex-js`, `cortex-py`, the extension and the dashboard are all clients of exactly
this surface. If this file and the Rust disagree, the Rust wins and this file is a bug.

```bash
cargo run --release --bin cortex-core          # http://127.0.0.1:3030
curl -s localhost:3030/health | jq             # open, no key, safe to probe
```

## Auth, binding and limits

| Thing | Behaviour |
| --- | --- |
| No `CORTEX_API_KEY` | Binds loopback only and answers every request from it. Starting on a routable address without a key **panics on purpose**. |
| Key set | Accepted as `Authorization: Bearer <key>`, `x-cortex-key: <key>`, or `?key=<key>`. Missing/invalid → `401 {"error":{"code":"unauthorized",…}}`. |
| `?key=` | Works so the WebSocket can connect from a browser. Do not use it elsewhere: query strings end up in proxy logs and history. |
| CORS | Only origins listed in `CORTEX_ALLOWED_ORIGINS`. No wildcard default. |
| Body size | 2 MiB per request → `413`. |
| Rate limit | `CORTEX_RATE_LIMIT_PER_MIN` per client IP (default 240) → `429`. |
| Extraction timeout | 30 s per LLM call; a slow provider does not hold a worker. |
| `owner` | Required for isolation. `default_user`, `user` and `default` normalize to `cortex://default`. Reads are always owner-filtered. |

Errors are always a real HTTP status with a machine code:

```json
{ "error": { "code": "unknown_job", "message": "no job job:4f2a…" } }
```

`501` means *not implemented* and the message names what is missing plus the env var that would
enable it. `503` means the dependency you configured is not answering.

## Endpoints

### `GET /health`
Open (no key). Every field is probed, not declared — `backend` is the store that actually answered.

```json
{
  "status": "ok",                       // "degraded" if the graph store fails a ping
  "version": "0.1.0",
  "uptime_secs": 12,
  "backend": "file",                    // or "surrealdb"
  "decay_policy": "soft",               // "off" | "soft" | "prune"
  "authenticated": false,
  "services": { "graph": true, "extraction": false, "vector_accelerator": false, "sessions": true, "cloud_sync": false },
  "counts": { "nodes": 41, "edges": 63, "pending_jobs": 0, "buffered_sessions": 1 }
}
```

### `POST /v1/recall` — the read path
Request: `{ "owner"?: string, "user_id"?: string, "prompt": string, "token_budget"?: number, "max_hops"?: number, "include_mesh"?: boolean, "explain"?: boolean }`

Response (`200`):

```json
{
  "briefing": "- [prefers] SurrealDB → uses  (confidence 0.91)\n…",
  "token_budget": 600, "tokens_used": 418,
  "memories_found": 12, "truncated": true, "scanned": 41,
  "owner_uri": "cortex://default", "node_count": 41, "edge_count": 63,
  "nodes": [ /* NodeDto */ ], "edges": [ /* EdgeDto */ ],
  "debug": [ /* only when explain: true */ ]
}
```

The budget is enforced here, not by the caller: `token_budget` is clamped to
`CORTEX_MAX_TOKEN_BUDGET`, `tokens_used <= token_budget` always holds, and `truncated: true` says
something was dropped instead of quietly shrinking your context. `briefing` is text a model reads;
`nodes`/`edges` are for UIs.

### `POST /v1/ingest` — the write path
Request: `{ "owner"?, "user_id"?, "session_id"?, "prompt"?, "messages"?: [{role, content, timestamp}], "source"?, "wait"?: boolean, "impact"?: number }`

- `prompt` **or** `messages` is required: neither → `400 {"error":{"code":"bad_request",…}}`, and a
  body that will not deserialize into `IngestRequest` → `422` from the extractor. `source` is stored
  as provenance (`mcp` | `extension` | `sdk` | `hydrator`).
- `impact` (1–10) is the decay dampener hint. The wire name is `impact`, not `importance`.
- Default is fire-and-forget → `202 { "accepted": true, "job_id": "job:…" }`, then poll
  `GET /v1/jobs/{job_id}` → `{ id, state: "queued|running|done|failed", created_at, finished_at?, result?, error? }`.
- `"wait": true` → `200 { "accepted": true, "job_id", "result": IngestReport }`; if the wait times
  out you get `200` with `{ "timed_out": true }` and the job keeps running. A timeout is not a
  failure and is never reported as one.

`IngestReport` (all counts are confirmed by the store, never estimated by the caller):

```json
{ "triplets_extracted": 3, "triplets_rejected": 0,
  "nodes_upserted": 5, "nodes_new": 2, "edges_upserted": 3, "edges_new": 3,
  "extractor": "heuristic",           // or "openrouter:<model>"
  "warnings": ["…"], "owner_uri": "cortex://default" }
```

### Sessions (what the extension uses)
- `POST /v1/session/message` — `{ session_id, owner?, user_id?, role: "user"|"assistant"|"system"|"tool", content, source? }`. Buffered per session; user turns are what becomes memory.
- `POST /v1/flush` — `{ session_id }` (or none = flush all) → `{ "flushed_sessions": 2, "results": [IngestReport] }`.
- Idle sessions flush after `CORTEX_SESSION_IDLE_SECS` (90) and the buffer holds
  `CORTEX_SESSION_MAX_MESSAGES` (40) per session; the oldest idle session is evicted at capacity.

### Browsing, editing, removing
- `GET /v1/memories?owner&q&limit&include_mesh` → `{ total, memories: [MemoryNode], edges: [RelationalEdge] }`,
  most recently **updated** first (`updated_at` descending — not retention, so a pinned old fact does not
  float to the top). `q` matches labels and aliases; `edges` are the subgraph those nodes induce, so the
  dashboard can draw them without a second request.
- `POST /v1/memories/{node_id}/lock` — `{ "locked": true, "label"?: "SurrealDB" }`. `locked: false` releases it. Locked nodes are exempt from fade and prune.
- `DELETE /v1/memories/{node_id}` → `204`, or `404 {"error":{"code":"not_found"}}`. Also removes the node's vector-index entries and cascades its edges.
- `GET /v1/resolve?uri=cortex://…&include_mesh=false&token_budget=400` → the packet for one URI.
- `POST /v1/sweep` → `SweepReport`:

```json
{ "policy": "soft", "evaluated_nodes": 41, "evaluated_edges": 63,
  "faded_nodes": 2, "depressed_edges": 4, "pruned_nodes": 0, "pruned_edges": 0,
  "protected_nodes": 1 }
```

Thresholds: retention `< 0.25` marks `fading` (and depresses edge weights) under `soft`; only
under `prune` is `< 0.05` deleted. `pruned_*` counts deletions the store confirmed.

### Moving the graph
- `GET /v1/export` → `200` with `Content-Disposition: attachment; filename="cortex-memory.json"`:

```json
{ "protocol": "cortex.memory@2", "exported_at": "…", "counts": { "nodes": 41, "edges": 63 },
  "nodes": [...], "edges": [...] }
```

  This is portable JSON, **not** JSON-LD: there is no `@context` yet. Every node id is a
  `cortex://`-style URI, so framing it as JSON-LD is a small script, not a rewrite.
- `POST /v1/import` — `{ owner?, nodes: [MemoryNode], edges: [RelationalEdge] }` →
  `{ success: true, nodes_new, edges_new }`. Ids are **recomputed from labels** on import
  (`node_id_for_label`, `edge_id_for`), which is what makes another machine's export land in the
  same graph instead of forking it. Cap: 50 000 records (`400` beyond that).

### Node and edge shapes
`MemoryNode` (raw record, as stored and as `/v1/export` returns): `key` (the node id — serialized as
`key`, accepted as `id` on input so older exports stay importable), `label`, `label_key`,
`aliases[]`, `stability` (≥ 1.0, reinforcement depth), `impact` (1–10, decay dampener), `locked`,
`fading`, `category`, `owner_uri`, `provenance`, `created_at`, `updated_at`, `last_accessed`,
`access_count`, `metadata`, `embedding[]` (skipped when empty).

There is **no stored `confidence` on a node**: retention is computed on read from
`stability`, `impact` and `last_accessed` (an Ebbinghaus curve with a 7-day base, `retention_
probability()` in `src/types/mod.rs`), and locked nodes always report `1.0`. Confidence lives on the
*edge*, where a claim actually exists.

`RelationalEdge`: `id`, `source`, `target`, `predicate`, `weight`, `confidence` (0–1), `impact`,
`locked`, `is_historical`, `owner_uri`, `reinforcement_count`, plus provenance and timestamps.

In API responses the trimmed view is `NodeDto` = `id`, `label`, `category`, `impact`, `stability`,
`weight_hint`, `locked`, `fading`, `retention`, `owner_uri`, `provenance`, `access_count`,
`last_accessed`, `updated_at`; `EdgeDto` = `id`, `source`, `target`, `source_label`, `target_label`,
`predicate`, `weight`, `is_historical`, `locked`, `owner_uri`, `reinforcement_count`. The label
fields on edges exist so a UI never has to join back to the node list.

### Live updates
`GET /ws` (upgrade). **Server to client only** — the handler never reads inbound frames, so there is
nothing to send and nothing to authenticate beyond the loopback/key rules (`?key=` in the URL is how a
browser passes the key, since `WebSocket` cannot set headers).

```json
{ "type": "WS_SYNAPSE_PULSE", "at": "2026-09-11T07:22:03Z" }
```

Real `type` values: `WS_SYNAPSE_PULSE` (graph mutated), `WS_DECAY` (sweep or delete changed
retention), `sweep` (the manual `POST /v1/sweep` result landed), `ping` (25 s keepalive). Frames carry
no payload: they are a nudge to refetch. A slow client whose broadcast queue overflows has frames
*skipped* (`RecvError::Lagged` → continue) rather than being disconnected, which is exactly why no
state is ever carried here — you can drop every frame and still converge on the next `GET`.

### 501 by design
| Route | Message you get |
| --- | --- |
| `POST /v1/mesh/publish` | `mesh_publish_disabled` unless `CORTEX_ALLOW_MESH_PUBLISH=1` **and** `CORTEX_MESH_PATH` are set; then it appends to that file. Body: `{ nodes: [], edges: [] }`. |
| `POST /v1/crawler/config` | the autonomous codebase watcher is a stub (`success: false`, `code: "not_implemented"`) |
| CRDT/device sync | no route. `src/api/sync.rs` says so; `proto/sync.proto` is a design artifact with no codegen. |

## Testing what you changed

```bash
cargo test                        # engine invariants + tests/api_contract.rs (HTTP in-process)
cd ../cortex-mcp && npm test      # 28 assertions over real stdio against a stub core
node ../scripts/verify-all.mjs    # every suite, and it names what it could not run
```

`tests/api_contract.rs` covers the auth matrix, loopback default, body cap, owner filtering, the
`501`s and the nested `/health` shape. Those are the behaviours that silently regress hardest, so
change them only with a test that fails first.
