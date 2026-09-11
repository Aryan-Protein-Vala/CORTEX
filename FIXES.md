# FIXES.md — what this cycle changed, and what was *not* verified

Companion to [`LAUNCH_AUDIT.md`](LAUNCH_AUDIT.md). The audit listed the problems;
this file is the ledger of fixes, the evidence for each, and — importantly — the
things that are **written but unverified**. Read the last section before trusting
any claim about the Rust core or the desktop app.

Branch: `arena/01a08ac5-cortex`. Everything landed as working-branch commits; no
PR, no merge to `main`.

## Verification status per surface

| Surface | Suite | Result | What it proves |
| --- | --- | --- | --- |
| `cortex-mcp` | `npm test` (`node --check` + `scripts/smoke.mjs`) | **28/28** | a real stdio JSON-RPC session: initialize, tool list (9 tools), recall returns stored facts without leaking raw ids, budget clamping + `truncated`, `isError` on core failure, label→id ambiguity refusal, secret scrubbing, path-allowlist on file ingest |
| `cortex-extension` | `npm test` (manifest audit + syntax + `scripts/test-harvest.mjs`) | **12/12** | consent gating, per-tab/per-site buffers, block stripping, in-batch dedupe, turn hashing, adapter degradation, Gemini flagged experimental; `check-manifest.mjs` validates permissions, icon set, description length, and that every `chrome.*` API used is permitted |
| `cortex-js` | `npm test` + `npx tsc --noEmit` + `npm run build` | **9/9**, clean, ESM+CJS+`.d.ts` verified importable | typed `CortexError` carrying the core's `code` + fix hint, `impact` on the wire, timeout + abort behaviour, `x-cortex-key` header |
| `cortex-py` | `python3 -m unittest discover -s tests -t .` | **10/10** | same contract as the JS SDK with stdlib `urllib` only; header casing verified against a stub server |
| `cortex-frontend` | `npm run verify` | green | `tsc --noEmit` with type checking **on**, 8 hydrate tests, `next build` (17 routes) |
| `scripts/test-setup-merge.mjs` | node, no deps | **8/8** | installer merges instead of overwriting, backs up, refuses unparseable JSON, tolerates an empty file, idempotent, `--remove` keeps other servers, `--dry-run` writes nothing, fails loudly on a missing entry point |
| `cortex-core` | `cargo test` | **cannot run here** | 61 tests written — 44 unit tests across 9 modules plus 17 integration (10 HTTP contract driving `build_router`, 7 engine invariants) — but there is no `cargo` in this environment and rustup is unreachable. CI is the first real build |
| `cortex-desktop` | `cargo check` / `tauri build` | **cannot run here** | Rust commands + config + icons generated and visually checked; never compiled. CI runs `cargo check` |

Re-run everything with the commands in `AGENTS.md`.

## The audit's ten headline findings

1. **Id / owner / recall correctness.** One derivation path (`types::{node_id_for_label,
   canonical_node_id, edge_id_for}`), owner-scoped reads *and* writes, `/v1/memories`
   filtered by owner, re-ingest idempotency, cascade delete on forget, vector point ids
   tagged with the embedding model so a model swap cannot mix namespaces.
   Covered by `tests/api_contract.rs` + `tests/engine_tests.rs` (uncompiled) and by MCP
   assertions "recall returns the stored fact" / "never leaks raw ids" (verified).

2. **Token budget was marketing, not code.** `recall::render_briefing` now packs against
   the budget and decides `truncated`; `CORTEX_TOKEN_BUDGET` / `CORTEX_MAX_TOKEN_BUDGET`
   are enforced server-side; the MCP clamps what a client can ask for and reports
   truncation instead of silently dropping; docs state the ceiling and what happens when
   it bites.

3. **Security.** `guard` accepts `Authorization: Bearer`, `x-cortex-key` or `?key=`;
   `/health` open; non-loopback bind without a key panics at startup; CORS allowlist from
   `CORTEX_ALLOWED_ORIGINS`; 2 MiB body cap; 30 s extraction timeout; per-IP rate map;
   `wait` on ingest acquires the job permit *before* spawning; SIGTERM drains and flushes
   buffered sessions. CI has a dedicated auth-gate job (401 without a key, 401 with a wrong
   one, 200 with the right one).

4. **Docs told people to install a stranger's package.** `npx -y cortex-mcp`,
   `pip install cortex-sdk` and a non-existent `@cortex/cli` are gone from every README, the
   landing page and the docs page, replaced by install-from-clone and the explicit registry
   warning in `README.md`. The Python package is renamed `cortex-py` (name confirmed free);
   `cortex-js` is `private: true` with `npm install file:../cortex-js`.

5. **Pricing pages led to dead buttons / fake checkout.** CTAs route to real pages
   (`/dashboard`, `/dashboard/docs`, `/contact`) and the paid tier says out loud that billing
   is not wired, nothing is charged, and the hosted core is a pre-order, not a product.

6. **The dashboard was theatre.** `typescript.ignoreBuildErrors` off; one-line fake KPIs,
   invented recall transcripts and `DEMO_NEURONS` deleted; data comes from `/health`,
   `/v1/stats`, `/v1/memories`, `/v1/recall`, `/v1/sweep`, `/v1/export` through a keyed
   server-side proxy; six explicit UI states including "core unreachable" (503
   `core_unreachable`) and "degraded"; demo content only behind `?demo=1`, labelled;
   hydrator parent-chain bug fixed and covered by tests; the brain inspector can lock and
   forget for real.

7. **The desktop app was a template.** Real window + CSP + bundle metadata; `src-tauri/src/lib.rs`
   implements 8 commands with error mapping to the core's codes; the key never enters the
   webview; deep link shows and focuses the window; icons generated from the CORTEX glyph;
   README states "unsigned, no auto-updater". Never compiled — CI runs `cargo check`.

8. **The extension was a privacy grenade.** Consent card per origin before any capture;
   read-only by default; badge + audit log + pause + manual flush; injection is a visible,
   editable composer insert; request-mode rewriting is opt-in and string-parts-only (the
   `parts[0] += string` bug that corrupted image turns is gone); fetch hook awaits the
   briefing under a 1200 ms cap so a send can never hang; icons, description and permissions
   validated by a script that immediately found two real violations.

9. **Legal/doc dishonesty.** AGPL stated on the landing page, in every README and in the
   new `Cargo.toml` metadata; the about page no longer threatens a lawsuit and instead
   explains the network clause plus a dual-license offer; terms and privacy rewritten so no
   sentence describes a hosted product that does not exist (the old policy literally listed
   data collected by "Cortex Cloud"); invented metrics and "zero latency / O(1) / infinite
   memory" claims replaced with what the code does; Vercel Analytics is now opt-in
   (`NEXT_PUBLIC_SITE_ANALYTICS`) and disclosed either way.

10. **Preserved on purpose** (the audit's "do not lose" list): graceful
    `Option<Arc<_>>` degradation for optional backends, the hourly sweep, BFS hop clamping,
    ingest caps, MCP protocol correctness, `prefers-reduced-motion`, the three.js brain view.

## Also fixed this cycle

- **`.cursor/mcp.json` was committed with a machine-specific absolute path** (`/Users/aryansharma/...`).
  It is now gitignored, generated by the installer, with `.cursor/mcp.json.example` committed.
  The path still exists in Git history; it is a local path, not a credential.
- **`setup-cursor-mcp.sh` used `cat >` to overwrite editor configs** and never installed the
  MCP server's dependencies. It now merges (verified by 8 tests), runs `npm install`, supports
  `--dry-run` / `--remove` / Claude Desktop, and has a PowerShell twin
  (`setup-cursor-mcp.ps1`) for Windows — see "not verified" below.
- **Stale `Cargo.lock` in `cortex-core`** pinned `axum 0.6.20` while the manifest required
  `axum = "0.7"` — silent until someone builds `--locked`, then a hard failure. Deleted; CI
  regenerates deliberately.
- **`src/main.rs` re-declared the whole module tree** (`pub mod types; …`) alongside `lib.rs`,
  so the binary compiled a second copy of the engine and `tests/` exercised a different tree
  than users ran. The binary is now a thin layer over the library and `[[bin]]` is explicit.
- **Dead Redis path removed:** `storage/working_memory.rs` was declared in `storage/mod.rs` and
  used nowhere; the `redis` dependency and the Dragonfly service in `docker-compose.yml` went
  with it. `docker-compose.yml` is now labelled optional at the top, with the env vars that
  actually turn each backend on.
- **`proto/sync.proto` looked wired and was not** (`tonic`/`prost` were dependencies, no
  `build.rs` existed, so nothing compiled it). Deps removed, header added saying the file is a
  design artifact and that publishing claims must not cite it.
- **Root `README.md` was 37 lines of posture** ("docker compose up -d", "If you don't know how to
  run Docker and Rust, close this tab") that contradicted the zero-infra default. Rewritten as
  the actual operating manual: 60-second run, repo table, what-is-not-built, registry warning,
  security paragraph, license, test commands.
- **Root `.env.example` was a to-do list** ("collect these keys while I build the rest of the
  stack") with Clerk keys for a product with no auth and a `cortex_god` password for a service
  nobody starts. It now lists only variables the code reads, grouped per surface, and names the
  ones that were removed and why.
- **Extension `npm test` did not run the manifest check** even though its README said it did.
  It now does — `check-manifest.mjs` is the first step.
- **Landing pipeline claims contradicted the code** ("Map your concepts using SurrealDB",
  "Smash it into Qdrant", "Delete the garbage", "Inject JSON-LD"). Rewritten to match: file
  default with optional accelerators, decay as a score, a token-budgeted briefing. The export is
  documented as portable JSON, not JSON-LD, because `GET /v1/export` emits no `@context`.

## Written but not verified (read this before shipping)

1. **The Rust core has never been compiled.** ~6k lines rewritten across `types`, `storage`,
   `ai`, `engine`, `api`. What was done instead: a structurally-aware scan of all 22 files
   (comments, strings, raw strings, char literals and lifetimes masked, then bracket matching
   and open/close pairing verified) — clean. What CI adds: `cargo fmt --check`, `cargo clippy`,
   `cargo test` (61 tests), a release build, an end-to-end smoke against the binary, and the
   auth-gate test. Realistic first-run outcome: formatting diffs and a handful of borrow-checker
   or type fixes. Budget 1–3 hours of CI-driven fixes.
2. **The Tauri app has never been compiled either** (and its `Cargo.lock` was not regenerated
   after the dependency edit). CI runs `cargo check`; a full signed bundle is deliberately not in
   CI because there is no certificate to sign with.
3. **`setup-cursor-mcp.ps1` has never run** — there is no PowerShell in this environment. The
   merge semantics mirror the bash version and the JSON handling is deliberately conservative
   (`ConvertFrom-Json`, BOM-less UTF-8, refuse-on-parse-error), but treat the first Windows run as
   a test: check the backup file appears and the other servers survive.
4. **CI has been authored, pushed, and never executed.** The branch is on GitHub
   (`arena/01a08ac5-cortex`, head `9be437f`, 8 commits from this cycle), and
   `.github/workflows/ci.yml` parses with 9 jobs mapped onto suites that all exist.
   But GitHub only *registers* workflow files present on the default branch, so
   `gh workflow run ci.yml --ref <branch>` returns 404, and the sandbox token gets
   `403 Resource not accessible by integration` on `…/actions/permissions` — it can
   push refs, not manage settings. To get the first run: open a PR from this branch
   (the `pull_request` trigger reads the workflow from the PR head — no merge needed),
   or land `ci.yml` on `main`. Until that run is green, items 1 and 2 above stay open
   in the honest sense: the Rust core and the Tauri app are reviewed, not compiled,
   and the workflow itself is unproven.

5. **Registry publishing is documented, not done.** `cortex-mcp` and `cortex-sdk` belong to other
   people; `cortex-js`, `cortex-py` and `cortex-core` names were checked as available but nothing
   was published (publishing needs accounts, 2FA and a decision about the `@cortex` scope).
6. **The extension has never been loaded into Chrome.** It has no `chrome.*` calls that the
   manifest does not permit (scripted check) and its logic is tested, but rendering, the consent
   card's behaviour on a real ChatGPT DOM and the composer insert need a 20-minute manual pass
   before any listing.
7. **The mesh is still 501 by design.** If you want `cortex://` federation for launch, that is a
   week of work (transport + moderation + per-user opt-in), not a flag flip.

## Second pass: docs, gates and the CI that was never run

- **`CORTEX_DECAY_POLICY` was documented with the wrong value.** `DecayPolicy::parse` maps
  `prune | delete | hard` to the `Prune` variant, and `as_str()` reports `prune` — so `/health` and
  the startup banner say `prune` while the README, `.env.example`, both legal pages and the FAQ told
  people to set `hard`. Every doc now uses `prune` and names the aliases. (AGENTS.md had been
  "corrected" to `hard` earlier in this session; that correction was itself the bug.)
- **Two CI steps asserted fabricated payloads.** `POST /v1/recall` takes `prompt`, not `query`;
  `POST /v1/mesh/publish` requires `{nodes, edges}`, so the old body would have 422'd before the
  handler could answer the honest 501. Both fixed, and the recall assertions now check
  `tokens_used <= token_budget` and `truncated == true` at a 32-token budget — the headline claim
  enforced against the running binary, not only in unit tests.
- **`scripts/verify-all.mjs`** runs all nine suites and prints an explicit `unverified` block for what
  it could not execute; today that is 7 passed / 0 failed / 2 skipped (cargo absent → core + desktop).
- **`cortex-core/API.md`** documents the HTTP surface from the structs: `NodeDto`/`EdgeDto` fields,
  why a node has no stored `confidence` (edges carry it; retention is computed), 400 vs 422, the real
  WS kinds (`WS_SYNAPSE_PULSE`, `WS_DECAY`, `sweep`, `ping`), inbound frames never read, and the 501 list.
- **`SECURITY.md`** replaces boilerplate with the actual model: plaintext file at rest, `?key=`
  rationale and warning, recalled memory as durable prompt-injection vector with what mitigates it,
  rate limit ≠ ACL, and a hardening checklist.
- **`.github/`**: issue forms (ask for `/health` + commit), PR template = the honesty checklist,
  Dependabot for cargo/npm/actions. No `cortex-core/Cargo.lock` exists, so cargo entries resolve on
  first run; `cortex-py` is excluded because it has zero dependencies.

## Caught by re-running instead of remembering

Three bugs in this cycle were only found by executing something rather than trusting
a mental model of it — worth recording because they are the same failure mode the audit
accused the codebase of:

- The CI file asserted `require('./dist/index.cjs').CortexClient` on `cortex-js`. That class
  has never existed; the SDK exports `Cortex` / `Client` / `CortexError`. The check would
  have failed CI for no reason and taught nobody anything. The artifact audit now lives in
  the package (`scripts/check-dist.mjs`, run as `npm run verify` and `prepublishOnly`).
- `cortex-mcp/package-lock.json` still declared version `1.0.0` after the manifests were
  unified. `scripts/check-versions.mjs` found it on its first run, which is the point of it
  (it now covers 14 files, including lockfiles, and its rewrite mode leaves lockfiles
  byte-identical apart from the version fields).
- Earlier, `setup-cursor-mcp.sh` would overwrite an unparseable config instead of refusing,
  and wrote `CORTEX_API_KEY: ""` when no key was set. Both were found by
  `scripts/test-setup-merge.mjs`, not by reading the script.

Rule for anyone continuing this: if a claim in this repo is checkable by running a command,
run the command in the same session that writes the claim.

## Next, in the order that buys the most trust per hour

1. Green CI on this branch — needs a PR or the workflow on `main` (see above); it fixes the
   "never compiled" caveats in items 1 and 2, and `cargo fmt` will land its own commit.
2. Manual Chrome pass with a real core (60 min), then file the Chrome Web Store listing text
   that `cortex-extension/README.md` already drafts.
3. Decide the npm story: `@cortex/mcp` scope, or publish `cortex-mcp-server` from this repo and
   update the install lines in all five READMEs and the landing page in one commit.
4. 20-user private beta through the MCP path only (the extension and the desktop app can wait for
   a signing story) — measure D7 recall accuracy, not installs.
5. Then, and only then, the hosted core + billing that the pricing page currently advertises as
   unbuilt.

## Third pass: `main` moved underneath the branch, so the two implementations had to be reconciled

While I was waiting for CI to run, `main` gained a commit — `07a3fe4`
"fix(core): Address production blockers and unify monorepo", +24,963 lines across 110 files,
which merged `landing-site` back in and then re-implemented the audit's fix list. It touches the
same files the branch rewrote, so PR #1 flipped to `CONFLICTING` (17 files).

Reconciliation, and how each call was made:

| Overlap | Kept | Why |
| --- | --- | --- |
| `cortex-core/src/api/server.rs`, `storage/graph_db.rs`, `storage/vector_db.rs` | branch | theirs wires `crate::storage::working_memory::WorkingMemory`, a module the branch deleted; taking it would reintroduce a dependency on Redis-backed state and undo the owner scoping, the loopback/CORS/auth ordering, and the honest `501`s. Their `graph_db`/`vector_db` additions turned out to be the same functions the branch already has (`find_node_by_label`, `get_*_by_owner`, `sweep_decay`, `deterministic_point_id`, `compute_local_embedding`) — diffed name by name, nothing unique to port. |
| `cortex-extension/*` (5 files) | branch | their version posts the composer request body without the consent gate and rewrites `parts[0]` (the image-turn corruption); the branch version is consent-gated, string-parts-only, and covered by 12 logic checks + the manifest audit. |
| `cortex-mcp/index.js`, `package.json` | branch | branch has 9 tools, `isError` on failures, realpath'd `cortex://` allowlist, secret scrubbing, and `scripts/smoke.mjs` (28 checks). |
| `cortex-js/*`, `cortex-py/cortex/client.py`, `setup-cursor-mcp.sh` | branch | same surface, but the branch's SDKs carry `CortexError` with per-code fix hints, 9 + 10 tests, and a `dist` audit that fails on a bad publish. Their Python package is `cortex/`, mine is `cortex_py/` — kept one layout instead of shipping two competing packages; renaming to `import cortex` is a one-commit follow-up if preferred. |
| `cortex-frontend/app/dashboard/page.tsx`, `cortex-desktop/src-tauri/tauri.conf.json` | branch | branch version is the one with six real UI states, `?demo=1` gating, `/api/core` proxying and the hydrator tests; desktop keeps `cortex-core` as a path dependency of the workspace Tauri config. |
| `.cursor/mcp.json`, `errors found.md` | main | user-authored local config and notes; no code. `.cursor/mcp.json` hardcodes `/Users/aryansharma/Desktop/CORTEX/...`, which is correct for that machine and wrong for everyone else — that is exactly why `setup-cursor-mcp.sh` writes `~/.cursor/mcp.json` instead. |
| `cortex-core/Cargo.lock` | branch (absent) | the branch does not commit the core lockfile; `cortex-desktop/src-tauri/Cargo.lock` is kept because it was generated by a real `cargo` and matches the Tauri 2 manifest. |

The merge also brought **two Rust tests** in `cortex-core/tests/engine_tests.rs` that were worth
naming: `test_briefing_label_resolution` built its own `HashMap` of labels and its own
`format!("Fact: {} -> [{}] -> {}")` loop, and `test_token_budget_truncation` truncated a string
inside the test and asserted on that. Neither called the crate, so both would have stayed green
forever — including on a core that returned raw `node:` ids and ignored the budget. Rewritten to
call `engine::recall::render_briefing` and `types::estimate_tokens`, which is what the launch
actually needs proven. One real detail surfaced while doing that: `render_briefing` counts tokens
on the untrimmed buffer and returns the trimmed string, so `tokens_used` may exceed
`estimate_tokens(briefing)` by one; the test tolerates that slack instead of hiding it.

Relative to the branch tip, the merge changed three files. The parallel implementation and mine
converged on the same diagnosis — the branch was already ahead on wiring, not on ideas.
