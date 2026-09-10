# Changelog

All notable changes to CORTEX. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project does not ship versions yet, so everything sits in `Unreleased` until there is a tag to
cut. The reason this file is blunt about unfinished work is the same reason the README is: a
launch that oversells dies in the first HN comment.

## [Unreleased]

### Added
- `AGENTS.md`: repo invariants (single id derivation path, no implicit memory deletion, real HTTP
  statuses, no fabricated capability claims, zero-infrastructure default) and the command table.
- `LAUNCH_AUDIT.md`: full launch-readiness audit with file:line evidence, severity ranking and the
  ten-item fix list that drove this cycle.
- `cortex-core/tests/api_contract.rs`: 10 HTTP contract tests driving the router in-process — auth
  matrix (bearer / `x-cortex-key` / `?key=`), loopback-only default, body cap, owner filtering on
  `/v1/memories`, `501` for mesh publish, and `/health` reporting the *nested* `services.*` flags
  including `cloud_sync: false`.
- `cortex-core/tests/engine_tests.rs`: 6 tests for id derivation, recall budget, decay policy and
  overwrite correction semantics.
- `cortex-mcp/scripts/smoke.mjs`: 28 assertions over a real stdio JSON-RPC session against a stub
  core (`npm run smoke` / `npm test`).
- `cortex-extension/scripts/test-harvest.mjs` (12 logic checks: extraction, per-site consent, dedupe,
  block stripping, turn hashing, adapter degradation) and `scripts/check-manifest.mjs` (manifest +
  permission audit that already caught a 155-character description and an unpermitted
  `chrome.notifications` call).
- `cortex-frontend`: `lib/core.ts` (typed core client + `describeFailure`), `lib/use-core.ts` (six
  explicit panel states, polling, `useCoreSocket`), `lib/hydrate.ts` (pure export traversal) with
  `scripts/test-hydrate.mjs`, `app/api/core/[...path]` allowlist proxy so the browser never holds the
  core key, `scripts/mock-core.mjs` + `npm run dev:mock`, `opengraph-image.tsx`.
- `cortex-js`: rewritten client (typed errors carrying the core's code and a fix hint, `impact`
  field on the wire), ESM + CJS + hand-run `tsc` declarations, 9 contract tests.
- `cortex-py`: standard-library client (`urllib` only, no install-time network), renamed from the
  squatted `cortex-sdk`, 10 unittest checks.
- `cortex-desktop`: `src-tauri/src/lib.rs` with 8 async commands (health, stats, list, remember,
  recall, lock, forget, config), HTTP/transport failures mapped to the core's own error codes,
  `cortex:changed` / `cortex:deep-link` events, real CSP and window config, generated app icons,
  hand-written UI (`src/index.html`, `main.js`, `styles.css`) that only talks to Rust via `invoke`.
- `scripts/test-setup-merge.mjs`: 8 tests proving the installer merges editor configs instead of
  overwriting them, refuses unparseable JSON, backs up before writing, is idempotent, and removes
  only its own entry.
- `.github/workflows/ci.yml`: core (fmt · clippy · test · release build · end-to-end smoke against the
  built binary · auth-gate test), MCP on 2 OSes × 2 Node versions, extension, both SDKs, frontend
  `verify`, installer merge tests, desktop config audit + `cargo check`.
- `CHANGELOG.md`, `.env.example` rewritten to only variables the code reads, per surface.

### Changed
- **Core rewrite for correctness:** one id derivation path for nodes/edges, owner-scoped reads and
  writes, token budget enforced in `recall::render_briefing` (with `truncated` surfaced), correction /
  overwrite handling in `apply_transcript` with store-confirmed counts, vector point ids tagged by
  embedding model, `delete_for_nodes` on forget, `impact_floor` threading.
- **Core security posture:** key required for any non-loopback bind, CORS allowlist, 2 MiB body cap,
  30 s extraction timeout, per-IP rate map, SIGTERM drain that flushes buffered sessions, honest
  `/health` (open) with real statuses everywhere else, `501` where nothing is implemented.
- **Zero-infrastructure default is now the documented and tested path:** `~/.cortex/cortex-graph.json`
  with the file backend asserted in CI; `docker-compose.yml` is labelled optional and Redis/Dragonfly
  are gone (the dead `working_memory` module and the `redis` dependency were deleted).
- `cortex-mcp`: 9 tools with label→id resolution that refuses ambiguous labels, `cortex_expand` for
  one-hop walks, resources + server instructions, `isError` results instead of thrown text,
  realpath-allowlisted file ingest, secret scrubbing before storage.
- `cortex-extension`: read-only harvesting by default with per-site consent, chip + audit log, pause
  and flush from the popup, `Alt+Shift+C` composer injection that is visible and editable before
  sending, request-body rewriting behind an explicit opt-in that only touches string parts, never
  creating parts (so image turns cannot be corrupted).
- `cortex-frontend`: `typescript.ignoreBuildErrors` turned off; dashboard and brain views read real
  endpoints; fabricated KPIs, `DEMO_NEURONS` and invented recall text removed — demo content now
  exists only behind `?demo=1` and says so; contact form persists to JSONL with honeypot + rate limit;
  Vercel Analytics gated behind `NEXT_PUBLIC_SITE_ANALYTICS` (off by default).
- `cortex-core/src/main.rs` is a thin binary over the library crate (no duplicated `mod` tree).
- Copy pass on the landing page, about, FAQ and both legal pages: no more claims about a hosted
  product that does not exist, no invented metrics, AGPL explained by its actual clause instead of a
  courtroom threat, and the pricing tiers say billing is not wired.
- `setup-cursor-mcp.sh` merges configs (with backup, `--dry-run`, `--remove`, Claude Desktop support)
  instead of `cat >` overwriting them, and runs `npm install` for the MCP server it points at.

### Removed
- Committed `.cursor/mcp.json` (contained a machine-specific absolute path); replaced by
  `.cursor/mcp.json.example` plus a gitignored generated file.
- `cortex-core/Cargo.lock` (stale: pinned axum 0.6 while the manifest required 0.7) — CI regenerates.
- `tonic` / `prost` dependencies and the never-compiled `working_memory` Redis module; `proto/sync.proto`
  is kept as a design artifact with a header saying plainly that nothing builds it.

### Known gaps
- The Rust core and the Tauri app have never been compiled in the environment where this rewrite was
  authored (no cargo, no network to rustup), so CI is the first real build. Expect lint noise, not
  logic surprises; the bracket/structure audit passed on all 22 Rust files.
- No registry names are ours: `cortex-mcp` on npm and `cortex-sdk` on PyPI belong to third parties, so
  nothing here is published and the docs forbid installing by those names.
- No mesh/CRDT sync, no hosted core, no accounts, no billing, no signed installers, no auto-updater.
