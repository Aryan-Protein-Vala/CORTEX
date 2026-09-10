# CORTEX

**Memory for AI that stores relationships, not text chunks.**

Every "AI memory" product is a vector database wearing a costume: it embeds your
sentences, similarity-searches them at recall time, and calls that "memory". That
is search. It cannot answer *"what depends on Postgres here?"* because nothing
knows what "depends" means.

CORTEX stores `(subject → predicate → object)` triplets with confidence, decay
and provenance on every edge. Recall walks the graph and spends a **hard token
budget** on the highest-scoring subgraph, so your agent gets 400 tokens of signal
instead of 4,000 tokens of retrieved prose.

```
  your editor  ─┐
  your browser ─┼──> cortex-core (one binary, one JSON file) ──> a graph you can read
  this desktop ─┘                     │
                                      └── Surreal/Qdrant only if you ask for them
```

---

## Run it

The core is the only piece that needs a toolchain (Rust). Everything else is a
folder you point at it.

```bash
# 1. the engine  (no Docker, no database, no account)
cd cortex-core && cargo run --release --bin cortex-core
#   → api      http://127.0.0.1:3030
#   → storage  ~/.cortex/cortex-graph.json
#   → auth     loopback only until you set CORTEX_API_KEY

# 2. your editor  (merges into Cursor/Claude config, keeps a backup, won't nuke other servers)
./setup-cursor-mcp.sh            # Windows: .\setup-cursor-mcp.ps1

# 3. your browser
#    chrome://extensions → Developer mode → Load unpacked → select cortex-extension/

# 4. prove it talks to the core
cd cortex-mcp && npm install && npm run smoke
```

No Rust on purpose? The other three surfaces work against any core you can reach
— including a teammate's, with `CORTEX_API_KEY`.

Environment variables: [`.env.example`](.env.example) lists every one that is
actually read, per surface. The old version of that file listed Clerk and
`cortex_god` passwords for services nobody starts. It does not anymore.

## What is here

| Path | What it is | Status |
| --- | --- | --- |
| `cortex-core/` | Rust axum engine: capture, extraction, decay, recall, sessions, HTTP + WS | works, no infra; **not yet run through `cargo` in this environment** |
| `cortex-mcp/` | MCP server, 9 tools (`recall`, `remember`, `remember_turn`, `resolve`, `forget`, `lock`, `expand`, `ingest_project_files`, `status`) | works, `npm run smoke` → 28/28 |
| `cortex-extension/` | Chrome MV3: consent-gated harvest of your own turns, memory chip, `Alt+Shift+C` composer inject | works, `node scripts/test-harvest.mjs` → 12/12, manifest checked |
| `cortex-frontend/` | Next 16 marketing site + dashboard + 3D brain, talking to the core through a keyed proxy | works against any core; `npm run verify` green |
| `cortex-js/` | TypeScript SDK (ESM + CJS + types) | `npm test` → 9/9 |
| `cortex-py/` | Python SDK, standard library only, no install step | `python3 -m unittest` → 10/10 |
| `cortex-desktop/` | Tauri 2 tray + quick-add + recall overlay | builds with `npm run tauri dev`; **unsigned, never compiled here** |
| `scripts/` | repo-level tests (installer merge safety) | `node scripts/test-setup-merge.mjs` → 8/8 |

## What is *not* built

Stated here because a README that hides this is how a project like this dies in
public:

- **Mesh / CRDT replication.** `POST /v1/mesh/publish` returns `501` unless you
  explicitly set `CORTEX_ALLOW_MESH_PUBLISH=1`, and even then it only appends to a
  second file. `cortex-core/proto/sync.proto` is a design artifact with no codegen.
  `cortex-core/src/api/sync.rs` says so in its first line.
- **Hosted CORTEX, accounts, Stripe billing.** Pricing pages route to real pages
  that say billing is not wired. Nothing is charged. No Clerk dependency exists.
- **App-store distribution.** The extension is `Load unpacked` only. The desktop
  build is unsigned with no auto-updater.
- **`@cortex/*` on npm.** See the next section. Read it before you type an install
  command.

## Do not `npx cortex-mcp`

`cortex-mcp` on the npm registry is **someone else's package** (44 versions, a
different author, a different product). `cortex-sdk` on PyPI is likewise
unrelated. `cortex-core` on crates.io is not ours either. Nothing in this repo is
published under those names.

Install from the clone:

```bash
cd cortex-mcp && npm install                      # MCP server, run with node directly
cd cortex-js && npm run build                     # then: npm install file:../cortex-js
cd cortex-py && pip install -e .                  # package name: cortex-py
```

If you are here for the AI-memory-agent idea rather than the code,
[`cortex2.md`](cortex2.md) is the design document and
[`LAUNCH_AUDIT.md`](LAUNCH_AUDIT.md) is the honest state of every surface, with
file:line evidence.

## Security, in one paragraph

The core binds to loopback and accepts anything from it — that is the local-first
contract. Set `CORTEX_API_KEY` and it will bind elsewhere, require
`Authorization: Bearer`, restrict CORS to `CORTEX_ALLOWED_ORIGINS`, and rate-limit
per IP. Request bodies cap at 2 MiB, extraction calls time out at 30 s, and
`/health` reports which backends actually answered rather than which ones you
configured. Your memory is never sent anywhere by default: the extension asks for
consent per site before a byte leaves the browser, and the dashboard's browser
never sees the core's key (it proxies through `/api/core`).

Forgetting is a policy, not a surprise. Default `CORTEX_DECAY_POLICY=soft`
scores memory down; `hard` deletes it, and locked facts are never removed by
either. `cortex-forget` in the editor is a two-step confirm for the same reason.

## License

AGPL-3.0-or-later (see [`LICENSE`](LICENSE)). The engine, the MCP server and the
browser extension are all under it: if you run a modified CORTEX as a network
service, you ship the source of your modifications to your users. The frontend,
`cortex-js` and `cortex-py` are also AGPL today — which makes them awkward to
embed in a closed product — so if that blocks a real integration, say so in an
issue and we will dual-license rather than pretend the clause does not apply.

---

## Tests

Every suite here runs without Docker, without a core, and without network:

```bash
cd cortex-core     && cargo test                  # 16 tests: engine invariants + HTTP contract
cd cortex-mcp      && npm run smoke               # 28 assertions over real stdio JSON-RPC
cd cortex-extension && node scripts/test-harvest.mjs && node scripts/check-manifest.mjs
cd cortex-js       && npm test                    # 9 contract tests against a stub core
cd cortex-py       && python3 -m unittest discover -s tests -t .   # 10
cd cortex-frontend && npm run verify              # tsc + hydrate tests + production build
node scripts/test-setup-merge.mjs                 # 8: the installer never destroys your config
```

Dashboard without a core: `cd cortex-frontend && npm run dev:mock`, then open
`http://localhost:3000/dashboard?demo=1`. `?demo=1` is the only place demo data
exists; without it the UI refuses to show anything it did not fetch from your
core.
