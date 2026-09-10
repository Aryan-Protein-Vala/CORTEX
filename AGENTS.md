# AGENTS.md — working notes for coding agents (and humans) in this repo

CORTEX is a local-first memory engine for AI tools: one Rust core that stores a
typed semantic graph, plus the surfaces that feed it (MCP server, Chrome
extension, desktop app, web dashboard, JS/Python SDKs).

## Non-negotiables

1. **A memory write must be readable by the same id it was written under.**
   Node ids are `node:<sha of the lowercased label>`, edge ids are
   `edge:<src>|<predicate>|<tgt>`. Derive them only through
   `cortex_core::types::{node_id_for_label, canonical_node_id, edge_id_for}` —
   never hand-assemble a prefixed id in a handler. `node:node:` is the bug that
   made recall silently return nothing for the entire product.
2. **Never delete user memory implicitly.** Forgetting is a score
   (`retention_probability`) and a `fading` flag. Physical deletion happens only
   under `CORTEX_DECAY_POLICY=prune` or an explicit user `DELETE`.
3. **Errors are HTTP errors.** Handlers return `Result<_, ApiError>` with a
   `code`; a 200 body that says `"error"` is banned. MCP tools must set
   `isError: true`.
4. **No capability claims that are not wired.** If a route has no
   implementation, answer 501 with a message saying what is missing and which
   env var would enable it. `/health` must probe, not assume.
5. **The default install must need no infrastructure.** No Docker, SurrealDB,
   Qdrant or Redis required; those are opt-in via `CORTEX_*_URL` and must degrade
   loudly in the logs.
6. **Do not silently overwrite a user's IDE config or delete their data.**
   Installers merge JSON and write timestamped backups.
7. **The browser extension may read only user-authored turns**, must never write
   into the chat input, and must show what it stored. Anything else is a trust
   violation on the surface with the most sensitive data.

## Layout

| Path | What it is |
| --- | --- |
| `cortex-core/` | Rust: axum API, file/Surreal graph store, recall + decay + overwrite engines, session buffer |
| `cortex-mcp/` | Node MCP server (stdio) — the primary integration surface for Cursor/Claude/Windsurf |
| `cortex-extension/` | Chrome MV3 extension that harvests ChatGPT/Claude/Gemini turns |
| `cortex-frontend/` | Next.js marketing site + dashboard (three.js synapse view) |
| `cortex-desktop/` | Tauri v2 tray app that supervises the core binary |
| `cortex-js/`, `cortex-py/` | SDKs |
| `cortex2.md` | Product spec. Treat it as the target, not as status. |

## Commands

```bash
# core
cd cortex-core && cargo run --release --bin cortex-core   # http://127.0.0.1:3030
cd cortex-core && cargo test                              # unit + API contract tests

# mcp
cd cortex-mcp && npm install && npm run check && npm run smoke

# frontend
cd cortex-frontend && npm install && npm run build        # type-checks are ON

# extension: load unpacked from cortex-extension/ at chrome://extensions

# desktop (needs a built core binary first)
cd cortex-core && cargo build --release --bin cortex-core
cd ../cortex-desktop && npm install && npm run tauri dev
```

## Where things are enforced

- Token budget: `cortex-core/src/engine/recall.rs::render_briefing` (packing and
  `truncated` are decided there, not by the caller).
- Auth / loopback / rate limit: `cortex-core/src/api/server.rs::guard`.
  Binding a non-loopback host without `CORTEX_API_KEY` panics at startup.
- Owner namespaces: `types::normalize_owner`. `default_user`, `user`, `default`
  all fold to `cortex://default`; the shared mesh is `cortex://global` and is
  only readable when a caller explicitly asks for it.
- Assistant turns are excluded from fact extraction in `ai::heuristic_triplets`
  (lines prefixed `ASSISTANT`/`SYSTEM`/`TOOL` are skipped) — keep that, or model
  output starts becoming the user's "facts".

## Testing expectations

Every bug class below has a test; add one before merging a change in the area:
id round-trip (`tests/api_contract.rs`), re-ingest idempotency, owner isolation,
budget enforcement, auth rejection, cascade delete, and MCP error semantics
(`cortex-mcp/scripts/smoke.mjs`, which runs against a stub core and needs no
network).

## Known not-implemented (do not "fix" by faking)

- `engine/crawler.rs`: watcher is a stub; `POST /v1/crawler/config` returns 501.
- `api/sync.rs`: CRDT cloud sync; always errors with "not implemented".
- Mesh publishing: gated behind `CORTEX_ALLOW_MESH_PUBLISH` and needs moderation
  + per-user opt-in before it can be turned on anywhere.
- Redis working memory (`storage/working_memory.rs`): exists, unused by default.
- Payments/auth for the hosted tier: nothing exists yet; pricing CTAs must not
  imply otherwise.

## Release hygiene

- The npm name `cortex-mcp` and PyPI name `cortex-sdk` are **someone else's
  packages**. Never document `npx -y cortex-mcp` / `pip install cortex-sdk` for
  this project; publish under a name this repo owns (or install from a local
  path / release tarball) and keep `"private": true` in the MCP package until
  that is settled.
- Version bumps go in `Cargo.toml`, `package.json` and `pyproject/setup.py`
  together, or not at all.
- Do not commit `node_modules`, `target/`, or `.next/`.
