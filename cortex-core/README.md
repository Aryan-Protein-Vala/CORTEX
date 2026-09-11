# cortex-core

The engine: one Rust binary, one JSON file, no services. It captures turns, extracts
`(subject → predicate → object)` triplets, decays them, and answers a question with a
**token-budgeted briefing** instead of a pile of retrieved text.

```bash
cargo run --release --bin cortex-core      # http://127.0.0.1:3030  ·  ~/.cortex/cortex-graph.json
curl -s localhost:3030/health | jq         # open: no key, and it never lies about what is running
```

Nothing here is optional infrastructure: no Docker, no SurrealDB, no Qdrant, no Redis.
`docker-compose.yml` is an accelerator menu for people who want those backends — see the
header comment in that file.

## Try it in ten seconds

```bash
# write (waits for extraction so you can see the result immediately)
curl -s localhost:3030/v1/ingest -H 'content-type: application/json' -d '{
  "owner": "you@local", "wait": true, "source": "curl",
  "prompt": "USER: I use pnpm in CI and I refuse to touch Webpack again."
}' | jq

# read back, inside a budget you control
curl -s localhost:3030/v1/recall -H 'content-type: application/json' -d '{
  "owner": "you@local", "prompt": "package manager", "token_budget": 400
}' | jq -e '.tokens_used <= .token_budget'
```

Both `owner` values matter: memory is namespaced by owner and every read is filtered by it.
Most "it forgot" reports are a mismatch between the writer's owner and the reader's.

## What is where

| Path | Role |
| --- | --- |
| `src/types/mod.rs` | `MemoryNode`, `RelationalEdge`, `SemanticTriplet`, and the **only** id derivation functions (`node_id_for_label`, `canonical_node_id`, `edge_id_for`) |
| `src/api/server.rs` | axum router, auth/`guard`, rate map, jobs, sessions, DTOs — [`API.md`](API.md) is the contract |
| `src/engine/recall.rs` | graph walk + scoring + briefing packing (`truncated` is decided here) |
| `src/engine/decay.rs` | Ebbinghaus retention, `off \| soft \| prune` policy, sweep plan |
| `src/engine/overwrite.rs` | correction semantics: a contradicting triplet obsoletes instead of duplicating |
| `src/storage/store.rs` | the default JSON-file store |
| `src/storage/graph_db.rs`, `vector_db.rs`, `session.rs`, `graph_store.rs` | optional Surreal/Qdrant backends, session buffer, the enum that picks between them |
| `src/ai/mod.rs`, `src/ai/openrouter.rs` | heuristic extractor (offline default) and the OpenRouter extractor |
| `proto/`, `src/api/sync.rs` | **not implemented**: no CRDT sync, no codegen; `sync.proto` is a design artifact |

## Configuration

`--help` does not exist; env vars do, and every one of them is listed with its real name and
default in [`.env.example`](../.env.example). The two that change behaviour the most:

- `CORTEX_API_KEY` — unset means loopback-only and *refuses to bind elsewhere*. Set it and the
  server starts accepting remote clients with `Authorization: Bearer`, CORS restricted to
  `CORTEX_ALLOWED_ORIGINS`, and a per-IP rate limit.
- `OPENROUTER_API_KEY` — unset means the offline heuristic extractor, and `/health` reports
  `services.extraction: false`. It does not pretend to be an LLM.

Decay is `CORTEX_DECAY_POLICY=soft` by default: sub-threshold memories are flagged `fading` and
rank out of your briefings, **they are not deleted**. Only `prune` deletes, and locked memories
are exempt from every policy.

## Tests

```bash
cargo test                       # 61 tests: 44 unit + 17 integration (10 HTTP contract in-process + 7 engine)
cargo clippy --all-targets       # lint (rustfmt/clippy come from ../../rust-toolchain.toml)
cargo fmt --all                  # do it before you commit, not in CI
```

`tests/api_contract.rs` drives the real `build_router`, middleware included, and asserts the
things that broke silently in earlier drafts: id round-trip, owner isolation, budget enforcement
with `truncated`, the auth matrix, the 2 MiB body cap, honest `501`s, and the nested `/health`
shape. `tests/engine_tests.rs` covers derivation, decay and correction semantics.

If you change a route or a DTO, update [`API.md`](API.md) in the same commit — clients
(`cortex-mcp`, the extension, both SDKs, this repo's dashboard) are written against that document.

## Known gaps, stated plainly

- The core has **never been compiled in the environment this code was authored in** (no `cargo`
  available, rustup unreachable). The structure was audited statically and the contract is covered
  by the tests above, but the first `cargo test` in CI is the real verdict.
- `POST /v1/mesh/publish` answers `501` unless `CORTEX_ALLOW_MESH_PUBLISH=1` **and**
  `CORTEX_MESH_PATH` are set; even then it is append-only with no moderation. Do not enable it on
  a shared host.
- `/v1/crawler/config` is a `501` stub. There is no autonomous repository watcher.
- Memory at rest is plain JSON: encrypt the disk, not the docs. See [`SECURITY.md`](../SECURITY.md).

License: AGPL-3.0-or-later, like the rest of the repo — including the clause that a modified
CORTEX offered as a network service must give its users the source of the modifications.
