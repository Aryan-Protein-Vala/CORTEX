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
   under `CORTEX_DECAY_POLICY=hard` (the values are `off | soft | hard`, default
   `soft`) or an explicit user `DELETE`. Locked nodes are exempt from both.
3. **Errors are HTTP errors.** Handlers return `Result<_, ApiError>` with a
   `code`; a 200 body that says `"error"` is banned. MCP tools must set
   `isError: true`.
4. **No capability claims that are not wired.** If a route has no
   implementation, answer 501 with a message saying what is missing and which
   env var would enable it. `/health` must probe, not assume — including
   `services.cloud_sync: false` and `backend` naming the store that actually
   answered. The same rule covers prose: no README/landing/FAQ claim about
   hosted sync, accounts, billing or "zero latency" that the code cannot do.
5. **The default install must need no infrastructure.** No Docker, SurrealDB,
   Qdrant or Redis required; those are opt-in via `CORTEX_*_URL` and must degrade
   loudly in the logs. `cortex-core/docker-compose.yml` is an accelerator menu,
   not an install step — never document it as the quickstart.
6. **Do not silently overwrite a user's IDE config or delete their data.**
   Installers merge JSON and write timestamped backups, refuse to write when the
   existing file does not parse, are idempotent, and support `--dry-run` /
   `--remove`. `scripts/test-setup-merge.mjs` enforces all of that; keep it green.
7. **The browser extension may read only user-authored turns**, must never write
   into the chat input invisibly, and must show what it stored. Injection into a
   composer is allowed only as a visible, editable insert the user can review
   before sending. Request-body rewriting is opt-in, may only append to an
   existing **string** `parts[i]`, and must never create or replace parts (an
   image pointer sits at `parts[0]`). Anything else is a trust violation on the
   surface with the most sensitive data.
8. **The webview/desktop UI never holds the core key.** All core traffic goes
   through a Rust `#[tauri::command]`; the JS side calls `invoke(...)` only.
   Likewise the dashboard never fetches the core from the browser — mixed content
   and private-network blocking kill it, and it would leak the key. Browser code
   calls `/api/core/*`, which proxies server-side against an allowlist.
9. **No fabricated UI data.** The dashboard shows exactly six states (idle,
   loading, empty, core-unreachable, degraded, loaded) and demo content exists
   only behind `?demo=1`, visibly labelled.

## Layout

| Path | What it is |
| --- | --- |
| `cortex-core/` | Rust: axum API, file/Surreal graph store, recall + decay + overwrite engines, session buffer |
| `cortex-mcp/` | Node MCP server (stdio) — the primary integration surface for Cursor/Claude/Windsurf |
| `cortex-extension/` | Chrome MV3 extension that harvests ChatGPT/Claude/Gemini turns |
| `cortex-frontend/` | Next.js marketing site + dashboard (three.js synapse view) |
| `cortex-desktop/` | Tauri v2 tray app over the core binary |
| `cortex-js/`, `cortex-py/` | SDKs |
| `scripts/` | repo-level tests (installer merge safety) |
| `LAUNCH_AUDIT.md` | the audit that drove this cycle; file:line evidence per finding |
| `FIXES.md` | what was changed, what was verified, and what was *not* verified |
| `cortex2.md` | Product spec. Treat it as the target, not as status. |

## Commands

```bash
# core — the only surface that needs a toolchain (Rust); no Docker required
cd cortex-core && cargo run --release --bin cortex-core   # http://127.0.0.1:3030
cd cortex-core && cargo test                              # unit + API contract tests
cd cortex-core && cargo fmt --all                         # see "Rust" below: first CI run will reformat

# mcp
cd cortex-mcp && npm install && npm test                  # node --check + 28 stdio assertions

# extension  (load unpacked from cortex-extension/ at chrome://extensions)
cd cortex-extension && npm test                           # manifest audit + syntax + logic tests

# front end
cd cortex-frontend && npm run verify                      # tsc --noEmit + hydrate tests + next build
cd cortex-frontend && npm run dev:mock                    # dashboard against scripts/mock-core.mjs

# sdks
cd cortex-js && npm test && npm run build                 # 9 contract tests, ESM+CJS+d.ts
cd cortex-py && python3 -m unittest discover -s tests -t . # 10 tests, stdlib only

# installer safety + repo hygiene
node scripts/test-setup-merge.mjs                         # 8 tests, no deps
node scripts/check-versions.mjs                           # all 10 manifests agree on one version
node scripts/check-versions.mjs 0.2.0                     # rewrite them (CHANGELOG entry is yours)

# desktop (needs a built core binary first)
cd cortex-core && cargo build --release --bin cortex-core
cd ../cortex-desktop && npm install && npm run tauri dev
bash cortex-desktop/scripts/gen-icons.sh                  # only if icons/ changes
```

`.github/workflows/ci.yml` runs exactly the above plus an end-to-end smoke of the
release binary (health → ingest → job → recall → mesh 501) and an auth-gate test.

## Rust

- `cortex-core/src/main.rs` is a thin wiring layer: it must not declare `pub mod`
  anything, or the binary compiles a second copy of the tree and the integration
  tests stop exercising what users run.
- `cortex-core/Cargo.lock` is **not** committed (the last one pinned axum 0.6
  while the manifest required 0.7 — a stale lock only bites under `--locked`).
  CI runs `cargo generate-lockfile`; do not add the lock back until CI is green.
- The request field for impact on the wire is **`impact`** (`IngestRequest`), and
  `/v1/flush` returns `{ flushed_sessions, results[] }`. `/health` nests
  `services.{graph,extraction,vector_accelerator,sessions,cloud_sync}`. Tests
  assert these; keep the shape.
- Rust written in this repo has been structurally audited (bracket/string/comment
  aware scan over all files) but **never compiled locally** — there is no cargo
  and rustup is unreachable in the authoring sandbox. Expect `rustfmt` diffs and
  clippy nits on the first CI run; do not "fix" a compile error by weakening a
  test.

## Where things are enforced

- Token budget: `cortex-core/src/engine/recall.rs::render_briefing` (packing and
  `truncated` are decided there, not by the caller). The MCP clamps the requested
  budget to `CORTEX_TOKEN_BUDGET` bounds and reports truncation.
- Auth / loopback / rate limit / body cap: `cortex-core/src/api/server.rs::guard`.
  Binding a non-loopback host without `CORTEX_API_KEY` panics at startup.
- Owner namespaces: `types::normalize_owner`. `default_user`, `user`, `default`
  all fold to `cortex://default`; the shared mesh is `cortex://global` and is
  only readable when a caller explicitly asks for it (`include_mesh`).
- Assistant turns are excluded from fact extraction in `ai::heuristic_triplets`
  (lines prefixed `ASSISTANT`/`SYSTEM`/`TOOL` are skipped) — keep that, or model
  output starts becoming the user's "facts".
- Label → id resolution in MCP goes through `findNode`, which refuses ambiguous
  labels instead of guessing; `cortex_lock`/`cortex_forget` accept either a label
  or an id for that reason.
- Consent + per-tab buffers: `cortex-extension/background.js`; the page-side
  consent card and composer insert are in `content.js`; the fetch hook that reads
  outgoing turns (never rewrites them unless "request" mode is on) is
  `inject.js` and it awaits the briefing under a hard timeout so a send can never
  hang.
- Frontend proxy allowlist + key injection: `cortex-frontend/app/api/core/[...path]/route.ts`.
- Contact form persistence (honeypot, rate limit, 503 when unwritable):
  `cortex-frontend/app/api/contact/route.ts` → `CORTEX_CONTACT_FILE`.
- Marketing-site analytics is opt-in: `NEXT_PUBLIC_SITE_ANALYTICS=1` and nothing
  otherwise (`components/analytics.tsx`). The privacy page documents both modes.

## Testing expectations

Every bug class below has a test; add one before merging a change in the area:
id round-trip (`tests/api_contract.rs`), re-ingest idempotency, owner isolation,
budget enforcement, auth rejection, cascade delete, MCP error semantics
(`cortex-mcp/scripts/smoke.mjs`, which runs against a stub core and needs no
network), harvest dedupe and consent (`cortex-extension/scripts/test-harvest.mjs`),
hydrate parent-chain traversal (`cortex-frontend/scripts/test-hydrate.mjs`), and
config merge safety (`scripts/test-setup-merge.mjs`).

## Known not-implemented (do not "fix" by faking)

- `engine/crawler.rs`: watcher is a stub; `POST /v1/crawler/config` returns 501.
- `api/sync.rs`: CRDT cloud sync; always errors with "not implemented".
  `cortex-core/proto/sync.proto` is a design artifact with no `build.rs`/codegen —
  do not re-add `tonic`/`prost` until something compiles it.
- Mesh publishing: gated behind `CORTEX_ALLOW_MESH_PUBLISH` + `CORTEX_MESH_PATH`,
  append-only, and needs moderation + per-user opt-in before it can be turned on
  anywhere.
- No Redis/Dragonfly at all: the old `storage/working_memory.rs` module and the
  `redis` dependency were deleted; `storage/session.rs` replaced that path.
- Payments/auth for the hosted tier: nothing exists yet; pricing CTAs must not
  imply otherwise.
- App-store listings: none. The extension is "Load unpacked" only, the desktop
  build is unsigned with no auto-updater — the READMEs say so.

## Release hygiene

- The npm name `cortex-mcp` and PyPI name `cortex-sdk` are **someone else's
  packages**. Never document `npx -y cortex-mcp` / `pip install cortex-sdk` for
  this project; publish under a name this repo owns (or install from a local
  path / release tarball) and keep `"private": true` in the MCP and `cortex-js`
  packages until that is settled. `cortex-py` deliberately uses a free name.
- Nothing under `@cortex/*` exists on npm; do not write install snippets that
  assume it does.
- Version bumps go in `Cargo.toml`, `package.json` and `cortex-py/setup.py`
  together, plus a line in `CHANGELOG.md`, or not at all. `node
  scripts/check-versions.mjs` enforces this (CI runs it): ten manifests, one
  version. Everything currently sits at `0.1.0` because nothing is published —
  do not bump a single package to 1.x "to look serious".
- Do not commit `node_modules`, `target/`, `.next/`, or a generated
  `.cursor/mcp.json` (machine-specific absolute path; `.cursor/mcp.json.example`
  is the committed template).
- Do not commit the audit artifacts' credentials-shaped placeholders as real
  secrets: `cortex_god` in `docker-compose.yml` is a localhost-only dev password.
