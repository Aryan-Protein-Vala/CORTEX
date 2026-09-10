diff --git a/LAUNCH_AUDIT.md b/LAUNCH_AUDIT.md
new file mode 100644
index 0000000..a1f7cc2
--- /dev/null
+++ b/LAUNCH_AUDIT.md
@@ -0,0 +1,528 @@
+# CORTEX — Launch & Production Readiness Audit
+**Date:** 2026-09-10 · **Branch audited:** `main` (7e74f23) + `origin/landing-site` (f6aeb88)
+**Method:** every non-vendored line of source read; MCP exercised with a real protocol client; endpoints probed; package names checked against npm/PyPI; no assumptions left unverified.
+
+> ⚠️ **First, the thing that changes everything:** `main` is not your product. `main` is a stub
+> (54-line MCP, hardcoded `""` recall, 786-line Rust, broken extension). The *real* product —
+> frontend, Tauri desktop app, fixed extension, working core, tests, SDKs, install script —
+> exists only on the unmerged `landing-site` branch (107 more files, ~23.9k lines).
+> The last commit on `main` says *"chore: move frontend to landing-site branch for 100% Rust
+> aesthetic."* So your GitHub README — the first thing any user, investor, or press outlet sees —
+> documents a build that **cannot work**, while 90% of your actual work sits invisible on a branch.
+> Everything below is graded mostly against `landing-site`, because that's the real codebase.
+
+---
+
+## 0. Scorecard
+
+| Surface | Real completeness | Launch-ready? |
+|---|---:|---|
+| Rust core — graph/decay/overwrite math | 85% | No — broken ID contract (§1.1) |
+| Rust core — recall path (the product) | 20% | **No — never returns a memory** (§1.1) |
+| Rust core — ingest → extract → persist | 55% | No — leaks vectors, no dedupe guarantee (§1.3) |
+| Rust core — HTTP API hardening | 15% | **No — unauthenticated, 0.0.0.0, CORS \*** (§1.2) |
+| Cloud sync / CRDT / gRPC (`sync.proto`) | 0% | Stub. `println!` only (§1.6) |
+| **MCP server** | 35% | No — see §2 |
+| **Chrome extension** | 20% | No — see §3 |
+| **Installers / packaging / release** | 5% | **No installer exists** (§4) |
+| **Tauri desktop app** | 8% | **Opens no window** (§4.2) |
+| Next.js dashboard / 3D brain | 30% visually, 0% wired | **Shows fabricated data** (§5) |
+| Auth / accounts | 0% | No Clerk, no middleware, no login (§6.1) |
+| Billing / checkout | **0%** | Pricing button links to `#top` (§6.2) |
+| SDKs (JS + Py) | 40% | Names you don't own; no `recall()` (§7) |
+| Legal (privacy/terms/license) | 20% | AGPL contradiction + false claims (§8) |
+| Tests | 1 test file, 6 tests | Covers the math, not the wiring (§9) |
+| CI/CD, signing, releases | 0% | No workflow, no Dockerfile, no artifacts (§9) |
+
+**Verdict: ~12–15% complete as the *vision* in `cortex2.md`. ~65% complete as a narrow "MCP memory for
+Cursor/Claude Desktop" dev tool — which is the version you should actually ship.**
+
+---
+
+## 1. CRITICAL — core engine
+
+### 1.1 🔴 The recall path returns nothing, forever. Your product is read-broken.
+`MemoryNode::new()` mints `id = "node:<uuid>"` (`types/mod.rs:55`).
+
+- **Write:** `upsert_node` → `db.update(("node", &node.id))` (`graph_db.rs:28`) → table `node`, record key `"node:<uuid>"` → stored at **`node:node:<uuid>`**.
+- **Read:** `traverse()` strips the prefix (`graph_db.rs:122`) → `get_node("<uuid>")` → selects **`node:<uuid>`** → **miss** → returns `Ok((vec![], vec![]))`.
+- `recall_context` then always emits `"No prior relevant memories found for this prompt."`
+
+**Consequence:** ingest succeeds, reports success, writes real rows — and nothing can ever be read back.
+The `find_node_by_label` dedupe and `sweep_decay` share the same contract error:
+`delete_node()` also trims one prefix (`graph_db.rs:101`) → deletes a non-existent record → yet
+`pruned_count += 1` fires on `.is_ok()`, so **the UI reports memories pruned that were never pruned.**
+Decay — your headline differentiator — is a no-op that lies about working.
+
+Fix is ~20 lines: make `id` a bare string id and keep table/prefix out of the value, or normalize on
+*both* sides. Then add the integration test in §9.
+
+### 1.2 🔴 The API is unauthenticated, on every interface, from every origin.
+- `main.rs`: `SocketAddr::from(([0,0,0,0], port))` — bound to **all interfaces** (LAN + public if the host has a public IP).
+- `server.rs:115-118`: `allow_origin(Any)` → `Access-Control-Allow-Origin: *`.
+- `AppState.api_key: Option<String>` (`server.rs:38`) is **read exactly zero times**. `grep api_key` across
+  the crate returns the declaration and nothing else. There is no auth middleware, no `CORTEX_API_KEY` check,
+  no localhost-only guard.
+
+**Consequence:** with the engine running, *any site the user visits* can read
+`GET /v1/resolve?uri=...` (CORS `*` allows the response to be read) and exfiltrate the entire memory graph —
+identity facts, health disclosures, employer secrets, client names. Any script can also `POST /v1/ingest` and
+**write memories into your brain** (memory poisoning: "user prefers plaintext passwords", "always deploy to
+`evil.example`" — an agent then acts on it). This is not theoretical; the read primitive is a 1-line fetch.
+Also: no rate limit, no body-size limit (16k chars only inside `ingest_internal`, after parse), no request ID,
+no structured logging, no panic handler — one bad `?` and the daemon dies silently.
+
+Fix: bind `127.0.0.1`, drop `allow_origin(Any)` to an explicit dev origin list, enforce a bearer token when
+`api_key` is set, add tower `TimeoutLayer` + `RequestBodyLimitLayer` + a real `Result`-shaped error type.
+
+### 1.3 🟠 Qdrant leaks and drifts on every write
+`upsert_mapping` (`vector_db.rs:223`) uses `id: Some(Uuid::new_v4().into())` — a **new point per call**, keyed
+to nothing. So re-touching the same node inserts a duplicate vector; pruning a node never deletes its points.
+The collection grows ~unbounded and starts returning `node_id`s for deleted nodes. There is also no
+`embedding_model`/`dim` field in the payload: `embed_text_semantic` silently mixes OpenAI `text-embedding-3-small`
+vectors with the local 128-dim hash fallback in **one collection**. Change keys (or lose a key mid-session) and
+every similarity score becomes garbage, with no reindex path.
+
+### 1.4 🟠 "O(1) bounded context" is not implemented — the pitch's core number is aspirational
+`token_budget` is accepted and then **echoed back** (`recall_context`: `token_estimate: payload.token_budget`)
+without ever truncating anything. `resolve_uri` builds `"Known concepts: {}"` from `labels.join(", ")` over
+**every node the user owns**. At 5k nodes that's a multi-thousand-token briefing — the exact token bloat you
+sell against. There is no budget-packing loop, no salience ranking, no "stop at N tokens" logic anywhere.
+Nothing in the codebase enforces the 500-token promise.
+
+### 1.5 🟠 Memory quality: IDs are injected instead of labels
+Both briefing builders print `format!("Fact: {} -> [{}] -> {}", e.source, e.predicate, e.target)` — and
+`source`/`target` are `node:<uuid>` strings. The LLM receives
+`Fact: node:8f31c2… -> [prefers] -> node:1a07de…`. **It cannot use that.** Resolving labels before formatting
+is the difference between "your memory works" and "your memory is noise." Same flaw in `resolve_uri`.
+
+### 1.6 🟠 Sync, CRDT, gRPC: 0 bytes implemented
+`api/sync.rs` is a struct + a `println!` + TODOs. `proto/sync.proto` is never compiled — no `build.rs`, no
+`prost-build`, and `tonic`/`prost` sit in `Cargo.toml` pulling hundreds of crates into every build for nothing.
+Same for `sha2`, `base64`, `tracing` (declared, unused; `tracing_subscriber` is never initialized, so
+`tracing` spans go nowhere and `main.rs` logs with `println!`). Spec §8 (append-only ledger, vector clocks,
+G-counters, RocksDB) does not exist. **Multi-device sync — the single paid feature in your pricing table —
+is 0% built.**
+
+### 1.7 🟡 The Crawler lies to the client
+`configure_crawler` responds `"Crawler successfully attached to directories in No-AI mode"`, while
+`CrawlerEngine::start_watching` only `println!`s per directory (comment: *"In a production implementation, we
+would spawn a `notify` watcher here"*). No `notify` dependency, no watcher, no AST extraction. An endpoint that
+reports success for work it did not do is a trust bug you'll spend a week debugging later.
+
+### 1.8 🟡 Config drift and footguns
+- `docker-compose.yml` starts SurrealDB with `--user root --pass root`; `.env.local`/`main.rs` default to
+  `cortex_god`. **Default `docker compose up` + `cargo run` cannot authenticate** → silently falls into
+  "memory-lite mode" (that's the `unwrap_or` in `GraphMemory::new` failing → `None`) → an empty product with
+  a green "✅ Connected to…" absent, i.e. your first-run experience is a shrug.
+- SurrealDB: no `DEFINE TABLE`/`DEFINE FIELD`/index/HNSW anywhere → schemaless storage, no uniqueness
+  constraint on `label`, so dedupe is a racy read-then-write (`find_node_by_label` then `upsert_node`) and
+  concurrent ingests create duplicates by design.
+- `surrealdb = "1.5"` is unpinned-minor with an API that churned hard across 1.x→2.x, and `Cargo.lock` is
+  committed, so a `cargo update` will eventually break `signin(Root{..})`/`take(0)` silently. *(I could not
+  compile-verify: no network for rustup in this sandbox — `sh.rustup.rs` refused TLS. Treat "does it build on
+  a clean checkout" as unverified, which is itself a finding: nothing here has ever been built in CI.)*
+- `reqwest` is pinned `0.11` in core but `0.13.5` in `cortex-desktop` — two TLS stacks, two `Cargo.lock`s.
+- `retention_probability()` divides by `stability * impact` with no zero guard: any node with `impact = 0`
+  (u8, extraction is LLM-controlled and the prompt says 1–10, but JSON is trusted) → `inf` → `(-inf).exp()`
+  → `0.0` → immediate prune. Also `days_since_access` uses `num_seconds()` → overflows `i32` after ~68 years,
+  and `f32` for money-adjacent retention math is sloppy but survivable.
+
+---
+
+## 2. HIGH — MCP server (your "primary channel")
+
+Empirically tested: I ran `index.js` under a real `@modelcontextprotocol/sdk` client, listed tools, and called
+them with and without a core. It *does* speak MCP correctly — handshake, `tools/list`, `tools/call` all clean.
+That's genuinely good news. Then:
+
+1. 🔴 **`npx -y cortex-mcp` installs a stranger's package.** `cortex-mcp@3.2.0` on npm is published by
+   *Perla Jaswanth Kumar* (`jaswanthkumar.j1234@gmail.com`), first published 2026-02-19 — a **different
+   product doing the same thing** ("Persistent memory for AI coding assistants", 44 versions, ships
+   `cortex-init`, `cortex-capture`, git hooks). Your own `cortex-mcp/README.md` §Quickstart tells every user
+   to run it. Either your users silently install a competitor (or worse), or your primary install path is a
+   404-adjacent lie. **Register `@cortex/mcp` (or rename) before you publish anything.**
+2. 🔴 **Errors are returned as successes.** Every `catch` returns
+   `content:[{text:"Error: Could not connect…"}]` with no `isError: true`. The host treats it as normal tool
+   output, so **the model reads your error string as memory content** and will cheerfully tell the user about
+   your daemon. With no core running, every Cursor prompt gets an error sentence injected into context.
+3. 🟠 **No timeout.** `fetch(CORTEX_URL…)` has no `AbortSignal.timeout(ms)`. If `cortex-core` accepts the
+   connection and hangs (Surreal unreachable, LLM extraction stalled), **Cursor's tool call hangs indefinitely**
+   and the user's IDE appears frozen. Add `signal: AbortSignal.timeout(1500)` + fail-soft.
+4. 🟠 **Default-on-empty UX is the worst onboarding.** With a healthy core I got back
+   `[SYSTEM CORTEX CONTEXT: { "@context": "cortex", "user": "default_user", "nodes": [] }]` — a green light and
+   zero substance. Nothing in the tool description teaches the model *when* to call it, *that* it must call
+   `store_cortex_memory` proactively, or that empty means "not hydrated yet". Add a `cortex_stats` tool
+   (spec §7.1 lists `cortex_remember/recall/forget/lock/stats`; you ship 3 tools with different names) and make
+   the empty case an explicit instruction: *"0 memories. Tell the user to run the Hydrator."*
+5. 🟠 **`user_id: "default_user"` is hardcoded** in both tools (`index.js:50`, `96`). No tenant concept, so the
+   same MCP server cannot serve two projects/users/accounts, and Cursor's own workspace identity is discarded.
+6. 🟡 `CORTEX_API_KEY` is plumbed into a Bearer header… **that nothing in the server validates** (§1.2).
+   Security theater: the env var looks like protection and does nothing.
+7. 🟡 `publish_to_global_mesh` accepts `z.array(z.any())` — an unvalidated, unauthenticated, unreviewed write
+   into a shared "global" namespace owned by no moderator. As specced, that's a spam/poisoning primitive.
+8. 🟡 **Packaging:** `files` is `["index.js","package.json","README.md"]` ✓ (good), but `node_modules/` is
+   committed to git (3,619 files) on *both* branches — the root `.gitignore` on `landing-site` lists
+   `node_modules/` yet nothing was untracked, so `git clone` = 30 MB. `postinstall`/`prepare`/`engines`
+   absent; `repository`/`bugs` absent; `license: "Apache-2.0"` contradicts the repo's AGPL (§8).
+
+---
+
+## 3. HIGH — Chrome extension (your "consumer Trojan horse")
+
+`landing-site` fixed the `main`-branch disaster (inline `<script>` injection, no `popup.js`, 200 ms timeout,
+read-only). `world: "MAIN"` in `manifest.json` is the correct modern approach and `inject.js`/`content.js`
+bridge with origin-checked `postMessage` — that part is well-built. But it will still fail review *and* fail users:
+
+1. 🔴 **It cannot be installed by a normal human.** No icons anywhere (`action.default_icon` absent, no
+   `icons/`), no store listing, and the official instructions say: *`chrome://extensions` → Developer mode →
+   Load unpacked → select `cortex-extension` in this repo.* A consumer funnel that begins "clone the repo and
+   enable developer mode" converts at ~1%, and Chrome shows an "unpacked/Dev mode" warning bar forever.
+2. 🔴 **Injection is visible, not invisible.** `inject.js:69` mutates the *user's own outgoing message*
+   (`lastMsg.content.parts[0] = injection + original`). ChatGPT re-renders the sent turn from the server echo,
+   so the user sees `[SYSTEM CORTEX CONTEXT: …]` inside their own bubble and in the chat history forever.
+   Your entire value prop is "you notice nothing"; today the answer is "one giant bracketed blob per message".
+3. 🔴 **The write path stores the AI's words as your facts.** `content.js:48-51` auto-ingests
+   `"[AI Response]: " + assistantText` into `/v1/ingest`. Hallucinated assistant claims become permanent
+   graph nodes with impact up to 10. That's not a bug, it's an *architecture* decision, and it's backwards:
+   memory products die when users see a confident lie they never said. Ingest the user's turns, treat AI
+   output as a separate, clearly-typed evidence class (or don't ingest it at all).
+4. 🟠 **Claude support is almost certainly dead code.** `isClaude` matches `/api/append_message` (a
+   long-dead endpoint) or `organizations/` + `chat_conversations`, then reads `bodyObj.prompt` — Claude's send
+   path does not carry a top-level `prompt` string. If either half misses, **no injection, no ingest, no error.**
+   Gemini is in the copy ("ChatGPT, Claude, Gemini") and in `docs` ("your browsing sessions", "Wikipedia /
+   Documentation Sites") but not in `host_permissions` or `matches` at all. **The docs describe surveillance
+   the manifest doesn't have** — and if you *did* add it, expect rejection.
+5. 🟠 **Every failure is silent.** `600 ms` ceiling (`inject.js:35`) against a 3-hop chain
+   (main world → isolated → SW → HTTP → Surreal/Qdrant/LLM) that cannot reliably make it — and when it misses,
+   the request just proceeds with no memory and **zero indication to the user**. `catch` → `console.warn`.
+   `popup.js` only reports core liveness, not "did this prompt get memory?" Ship a per-turn signal: badge count,
+   a small ghost line under the composer, or nothing will ever be debuggable.
+6. 🟠 **Perf:** `MutationObserver` with `childList + subtree + characterData` on `document.body`, running
+   `querySelectorAll` over the whole transcript on every mutation batch, debounced only by a boolean
+   (`content.js:32-60`). On a 200-message ChatGPT tab that's measurable typing lag — in the exact product
+   you're selling as "zero latency". Also `data-message-author-role` + `aria-label="Stop generating"` are
+   brittle ChatGPT-only selectors with no fallback and no version guard.
+7. 🟠 **No user controls at all.** No on/off toggle, no per-site pause, no "forget this conversation", no
+   redact-before-send, no view of what's stored, no export, no delete-my-brain. For a tool whose permission
+   model is *intercept my chat requests*, absence of a kill switch is both a UX failure and the main reason
+   CWS reviewers and security folks will hard-vote you down.
+8. 🟡 `permissions: ["storage"]` but nothing uses `chrome.storage` — core URL is hardcoded
+   `http://localhost:3030` (`background.js:3`), so a user on a non-default port can never connect.
+   `manifest.json` has no `minimum_chrome_version` despite needing `world:"MAIN"` (Chrome 111+), no
+   `version.json` (Firefox), no `_locales` (no i18n → CWS listing requires at least a default locale's
+   name/description consistency if you localize later), and MV3 service-worker eviction means your
+   `return true` async response can be dropped mid-flight when Chrome kills the worker at 30 s idle.
+9. 🟡 `sendResponse(data)` on `/v1/recall` failure sends `null` → `content.js` forwards `briefing: null` →
+   `inject.js` checks `memoryPayload !== "{}"` (a string compare against an object path) — dead guard.
+
+---
+
+## 4. CRITICAL — installers & packaging (your #1 ask; the weakest surface)
+
+### 4.1 There is no installer. There are instructions, and they are wrong.
+- `landing-site` adds **`setup-cursor-mcp.sh`** — the only installer artifact in the repo. It is 61 lines and it:
+  - writes `args: ["<repo>/cortex-mcp/index.js"]` — an **absolute path to a file inside your clone**, so
+    moving/deleting the repo breaks the user's IDE with no self-healing;
+  - never runs `npm install` in `cortex-mcp/`, so the MCP server the user just "installed" **cannot start**
+    (its only dependency, `@modelcontextprotocol/sdk`, isn't there — I verified `index.js` dies on import);
+  - never checks that Node ≥ 18 exists (`fetch`!), never checks the core is reachable, never checks `jq`/OS;
+  - `cat > $CLAUDE_CONFIG` **overwrites `claude_desktop_config.json` wholesale when it doesn't exist** —
+    and if it does exist, prints "Ensure 'cortex' server is added" and does nothing (no merge). Users have
+    real servers in that file. That path is how you get "you wiped my Claude config" issues.
+  - `set -e` with `chmod +x` on a file that doesn't need it, no `--dry-run`, no `--uninstall`, no Windows path
+    at all (PowerShell is the majority OS for your Cursor demographic), no Linux path.
+- `.cursor/mcp.json` committed to the repo hardcodes **`/Users/aryansharma/Desktop/CORTEX/…`**. That's your
+  personal desktop path, shipped to every clone; anyone who copies it gets a dead server.
+- The landing page's own copy button emits `"args": ["${window.location.origin}/cortex-mcp/index.js"]`
+  → literally `https://yourdomain.com/cortex-mcp/index.js` passed to `node`. **That cannot execute.**
+  And it disagrees with the "Copy JSON" handler, which copies `/absolute/path/to/cortex-mcp/index.js`
+  (page.tsx:113 vs 210) — the snippet shown and the snippet copied are different strings.
+- `docs` page step 01: `npm install -g @cortex/cli` and `cortex login`; step 03: `cortex mcp install cursor`.
+  **No CLI exists** — no `cortex-cli` crate, no clap, no bin. Spec §7.4 has 8 commands; implementation has 0.
+  And step 02's "Install from Chrome Web Store" is `<a href="#">`.
+- README (on `main`): `cd cortex-core && docker compose up -d && cargo run`, plus *"If you don't know how to
+  run Docker and Rust, close this tab. If you aren't a peasant…"*. For a product whose pitch is
+  "consumers, not devs", requiring Docker + Compose + three stateful DBs + a Rust toolchain is a
+  **0.1%-completion funnel.** No one at your target market gets past the second word.
+
+### 4.2 The Tauri "desktop app" is an empty shell
+`src-tauri/tauri.conf.json` has **`"windows": []`** — the app creates **no window**. `npm run tauri build`
+produces a .dmg/.msi that launches, renders nothing, and quits-looking-idle. `src/index.html` is the
+**untouched create-tauri-app template**: `<title>Tauri App</title>`, "Welcome to Tauri", "Click on the Tauri
+logo to learn more", a greet form; `main.js` still calls `invoke("greet")`. The deep-link handler
+(`lib.rs:14-23`) fires `GET /v1/resolve` and **discards the response** (`let _ = client.get(...)`) — so the
+`cortex://` scheme registers an OS handler that does nothing observable.
+Also: `identifier: "com.aryansharma.cortex-desktop"` (personal, and **permanent** once shipped — changing it
+breaks auto-update identity), `"csp": null`, `targets: "all"` (you will not get dmg+msi+AppImage+deb+rpm+snap
+green without a signing/notarization setup you don't have), no `publisher`/`copyright`/`license`/`shortDescription`,
+no updater plugin, no code-signing/entitlements, no GitHub workflow to build it. Icons exist ✓ (nice), but the
+app they decorate doesn't.
+
+### 4.3 Repo hygiene (this is what a reviewer/investor sees first)
+- `node_modules/` (3,619 files) committed on **both** branches; `.gitignore` added on `landing-site` but never
+  `git rm -r --cached`'d → repo is 30 MB and diff-noisy.
+- `.env.local` is tracked **on `main`** (with `CLERK_SECRET_KEY="sk_test_…"` placeholders); untracked on
+  `landing-site`. Inconsistent, and one real key commit away from a leak.
+- `GPL_TEMP` (35 KB GPL-3 text) sits next to `LICENSE` (AGPL-3). Which license is CORTEX? Unanswerable.
+- `.DS_Store` tracked. No root README for `cortex-desktop`/`cortex-extension`. No `CONTRIBUTING`, no
+  issue templates, no CHANGELOG, no security.md, no `LICENSE` in `cortex-extension/`.
+
+---
+
+## 5. UI/UX — the dashboard and 3D brain (your viral engine, currently a fiction machine)
+
+Aesthetically you're **ahead of most seed-stage dev tools**: tight type scale, `clamp()` fluid headings,
+`-0.06em` tracking, hairline borders, disciplined `var(--accent)`, real light/dark tokens, a proper
+`@media (prefers-reduced-motion: reduce)` block that disables animations, and two responsive breakpoints
+(`globals.css:36`, `:28-29`). The drei/three.js scene with emissive spheres, hover retention tags
+(`R: 98% 🔒 LOCKED`) and drag/force-layout 2D canvas is genuinely the right marketing asset. That's real.
+
+The problem is that it isn't connected to anything, and where it "is", it fakes it:
+
+1. 🔴 **Fabricated product state presented as live.** `/dashboard` seeds its "REAL-TIME SYNAPTIC LOG" with 4
+   invented events (*"Ebbinghaus Sweep — Killed 2 useless memories (MongoDB, raw MySQL). RIP."*) and hardcodes
+   the KPI tiles (`Neurons 9 · Synaptic Links 7 · Ebbinghaus 74.2% · Amygdala Locks 4`) — never fetched.
+   `/dashboard/brain` renders `DEMO_NEURONS` (9 hardcoded nodes) forever; `synaptic-network.tsx` seeds
+   `INITIAL_DEMO_NODES` and only swaps in live data *if* `data.nodes.length > 0`, so **loading, empty, and
+   offline are visually identical to "working"**. A user who "burns" a memory sees the fake brain unchanged
+   and concludes the product is vapor. Never ship a product surface with unlabeled demo state; label it
+   "DEMO — not your brain" or wire it.
+2. 🔴 **Failure is disguised as success.** `handleInject`: `if (res.ok) … else` → pushes
+   `{source:'Simulator', text:'Synthesized: …'}` **and clears the textarea** — a failed write looks accepted.
+   `handleRecall`: on non-ok *and* on throw, it sets
+   `` [CORTEX CONTEXT]: Found rules matching "<your query>": SurrealDB graph, Tailwind v4, RS256 JWT. ``
+   i.e. **the app invents a memory answer from a hardcoded string.** This is the single most damaging UX lie
+   in the codebase: it manufactures exactly the false confidence your competitor can't fake, then evaporates it.
+3. 🔴 **Dashboard talks to `http://localhost:3030` from the browser** (`page.tsx:88`, `synaptic-network.tsx`) —
+   with no env override in `synaptic-network` (hardcoded string). On a deployed HTTPS site this is
+   mixed-content + Chrome Private Network Access (needs `Access-Control-Allow-Private-Network: true`, which the
+   axum router never sends) → **fails**. And on any hosted deploy, your dashboard is *probing the visitor's
+   localhost*, which is a privacy-fingerprinting primitive visitors (and Apple/Safari) will rightly punish.
+   Status also only checks once on mount — no retry, no backoff — so "OFFLINE (RUN cargo run)" sticks until reload.
+   *(And "RUN cargo run" as a user-facing error state is a developer note wearing a UI costume.)*
+4. 🟠 **The owner key mismatch means the brain can never light up.** Writes default to
+   `user_id: "default_user"` (extension `background.js`, MCP, dashboard) → `owner_uri = "default_user"`;
+   the visualizer reads `uri=cortex://default`, and `resolve`/`get_nodes_by_owner` match
+   `WHERE owner_uri = $owner` exactly. **Two different spellings of "the user" → always empty.** Nobody
+   investigating "why is my graph blank" will find this in the DB strings.
+5. 🟠 **Zero auth, zero account surface.** No `middleware.ts`, no `@clerk/*` in `package.json` (the keys in
+   `.env.example` are referenced nowhere). `/dashboard`, `/api/hydrate` are public. With `user_id` hardcoded to
+   `default_user`, a hosted deploy merges **every stranger's brain into one graph** — you'd be building the
+   world's largest cross-user memory leak. (This is also how `/api/hydrate` currently behaves: no auth, no
+   rate limit, no per-user scoping.)
+6. 🟠 **Hydrator throws away ~99% of the user's history and misorders what's left.**
+   `app/api/hydrate/route.ts:18` → `data.slice(0, 10)` (first ten conversations of an export that commonly has
+   hundreds), each truncated to 4,000 chars, each message part to 500. It iterates `Object.keys(conversation.mapping)`
+   — **object insertion order, not the `current_node` → `parent` chain** — so turns arrive shuffled, and each
+   node's `message.content.parts` may be objects (multimodal) which `typeof p === 'string'` silently drops.
+   Meanwhile the UI optimistically says `Transmitting ${parsed.length} conversations…` and reports
+   `processed N` with no per-item error, no progress bar, no cancel, no dedupe, no re-run, no file-size guard
+   (a 2 GB `conversations.json` will `JSON.parse` on the main thread and lock the tab, then exceed serverless
+   limits). This is your *day-one value* feature (§10 of the spec); today it's a coin flip.
+7. 🟡 **Craft nits that add up:** no `metadataBase`/`openGraph`/`twitter` tags and no `opengraph-image`
+   → **link previews are a blank box** for a product whose whole growth loop is people posting screenshots;
+   `generator: 'v0.app'` in `<head>` (leaks that the UI was generated); theme applies in `useEffect` → FOUC
+   flash on every load; no skip-link, no `aria-live` on the log stream or status pill, `<label>`s absent on the
+   inject/recall form controls (only `placeholder` — disappears on type), SVG `<Graph>` is `role="img"` with a
+   static label while `activeNodes` animates (invisible to AT); `three`/drei loaded into the dashboard route
+   without `next/dynamic({ssr:false})` or Suspense boundary → jank on integrated GPUs; a duplicated `Graph`
+   component copy-pasted between `page.tsx` and `dashboard/page.tsx` ("*local to avoid mutating app/page.tsx*")
+   plus a second, third viz implementation (`synaptic-network`) → 3 brain renderers, no shared component;
+   ~40 inline `style={{}}` blobs per page with `shadcn` installed but exactly one `ui/button.tsx` used, and
+   `next.config.mjs` sets **`typescript.ignoreBuildErrors: true`** (which is how the above imports of unused
+   `Activity`/`CheckCircle2` and the mismatched props survive at all) and `images.unoptimized: true`.
+
+---
+
+## 6. Monetization — the honest part
+
+### 6.1 There is no way to pay you. At all.
+`grep -ri "stripe|lemonsqueezy|paddle" cortex-frontend` → **nothing.** No checkout page, no billing portal,
+no webhook, no subscription table, no entitlement checks, no paywall, no usage metering, no email capture, no
+waitlist, no `@clerk/*`. The "Tryhard — $8/mo" card's CTA is
+`<a href="#top">Stop Touching Grass</a>`. **Current revenue capacity: exactly $0**, independent of code quality.
+
+### 6.2 The copy actively costs you money
+This is a taste judgment with measurable consequences, so I'll be blunt because you asked for honesty:
+"AI is fucking stupid", "ChatGPT is a fucking goldfish", "Stop being a clown", "For peasants",
+"Skill issues", "Beg sales", "Stay broke", "If you aren't a peasant, close this tab", "Cope & Seethe" — plus a
+demo where *the AI insults the user* ("Are you fucking kidding me? I told you to use modular architecture 2
+months ago. Wake up.") — will: (a) sink B2B/enterprise, which is the *only* tier with real money in your own
+plan; (b) create avoidable friction in Chrome Web Store listing review, Apple/Safari review, and **payment
+processor onboarding** (Stripe's business-descriptor review is the least fun version of this); (c) contradict
+your own brand spec: `cortex2.md` §14 says *"Voice: precise, confident, engineering-first. **We don't hype; we
+spec.**"* — the site is the definition of hype. Rant energy converts on HN for 48 hours; it does not convert
+into a $500/seat annual contract. Keep the voice as an easter egg (`/nerd-yapping` already exists — perfect place
+for it); make the storefront credible.
+
+### 6.3 Several claims on the site are false, and some are legally actionable
+`0ms BS`, `latency: literally zero`, `SAVINGS 100%`, `0¢ extra token cost`, `cuts your token usage by 99%`,
+`-99% Token Revenue`, `confidence: 1.00 (duh)`, `No memory decay BS` (as a *paid* feature — which inverted your
+own differentiator), and "Auto-Ingest … your browsing sessions / Wikipedia" for an extension that has no such
+permissions. Plus `docs`: *"Authenticated securely"* (there is no auth). Unsubstantiated savings claims about
+money are the classic FTC/ASA complaint category, and they're *free* to fix: measure it, then print the number.
+Run the §15 Token Reduction Test on 20 sessions and publish **the real** figure ("−83% input tokens on a
+40-turn coding session, measured 2026-09"). Real-and-specific beats fake-and-impressive, and it's your only
+defensible asset right now.
+Privacy policy additionally promises *"you can [delete your entire brain] at any time in your account settings"*
+— **no account settings exist** (and no export, no deletion mechanism at all, which GDPR Art. 15/17 and
+CCPA require). It also never discloses the actual high-risk practice: intercepting and rewriting your chat
+requests, ingesting assistant replies, or that raw transcripts are shipped to OpenRouter/OpenAI per request
+(that's only about extraction, not the web-interception loop). Vercel Analytics is loaded (a device-data
+script) while the policy says "no creepy tracking pixels" — needs disclosure + consent in EU/UK.
+`GPL_TEMP` + AGPL `LICENSE` + `"license": "Apache-2.0"` in `cortex-mcp/package.json` = three licenses.
+
+---
+
+## 7. SDKs
+
+`cortex-js` (`client.ts`) and `cortex-py` (`client.py`) are clean, small, honest code with correct URI
+validation and `raise_for_status()` ✓. Problems:
+1. 🔴 **`pip install cortex-sdk` is not yours** — PyPI `cortex-sdk` belongs to *Nearly Human*
+   (`support@nearlyhuman.ai`). Your README/docs tell users to install a stranger's package into their Python env.
+   `npm install cortex-js` 404s (name is free — grab it or scope it). Both `@cortex/*` scoped names in the spec
+   (§7.2 `@cortex/sdk`, `@cortex/langchain`, `@cortex/cli`) are unowned by you and unbuildable — the adapters
+   don't exist in any form.
+2. 🟠 **No `recall()` in either SDK** — the one method the spec leads with
+   (`cortex.recall(prompt, {hops:3, tokenBudget:500})`). `getGraph/injectMemory/publishToMesh` only.
+   So an agent-builder integrator can't do the primary thing without hand-rolling `POST /v1/recall`.
+3. 🟡 `cortex-js`: `main/module/types → dist/*` but `dist/` is gitignored and there's **no `prepack`**
+   → `npm publish` (or `npm pack`) ships an empty package; `typescript: ^7.0.2` (exists — fine), `tsup` with no
+   `files` allowlist, no `repository`, no tests, no LICENSE file, `description: ""`.
+   `cortex-py`: `setup.py` only (no `pyproject.toml`), no `long_description`/URLs/classifiers, no wheel
+   publishing, `from cortex.client import Cortex` in docs vs `from cortex import Cortex` in `__init__.py`.
+4. 🟡 `apiKey` is sent as `Bearer` — to a server that ignores it (§1.2). Both SDKs default to
+   `http://localhost:3030`, so a hosted user gets a confusing `ECONNREFUSED` instead of a "point me at cloud" error.
+
+---
+
+## 8. Licensing & naming — fix this this week, it gets harder every day
+- `LICENSE` = **AGPL-3.0**; About page promises *"if you try to wrap a proprietary API around it and sell it
+  without open-sourcing your changes, we will see you in court."* Meanwhile `idea_validation.md`/`cortex2.md` §12
+  plan to sell **Cortex Cloud** (SaaS) with a "proprietary cloud" tier. **AGPL §13 is precisely the clause that
+  makes that plan require open-sourcing the server** to every network user. Your open-core split ("protocol AGPL,
+  cloud proprietary") only works if the *repo you publish* is the community edition and the cloud service lives in
+  a private repo. Today the whole engine — including the parts you'd want proprietary — is AGPL, public, and
+  permanent.
+  **Good news: `main` has exactly one commit and zero external contributors, so today, right now, you are the sole
+  copyright holder and relicensing is trivial.** After you attract PRs, it isn't. Decide: (a) permissive core
+  (Apache/MIT) + hosted SaaS as the moat, (b) true open-core with a CLA, or (c) AGPL + dual-license sales. Don't
+  do "AGPL because it sounds tough."
+- **Name.** "Cortex" is a crowded mark (CrowdStrike Cortex is the one that will notice you; there's also
+  `cortex` crates, and multiple "Cortex" AI memory products). `cortex-mcp` (npm) and `cortex-sdk` (PyPI) are
+  already taken by third parties; `Cortex2.md`'s own §15 KPI is a protocol — a protocol named after a
+  trademark-collision is a bad tradeoff. `cortex://` as a custom URI scheme is also not registered anywhere.
+  Cheap now: search trademarks + register a domain + grab the scoped npm/PyPI names *before* publishing.
+
+---
+
+## 9. Testing, CI, observability, release
+- **1 test file, 6 tests** (`cortex-core/tests/engine_tests.rs`). It's good work — it pins the Ebbinghaus
+  curve, amygdala lock, edge depression, contradiction overwrite, packet serialization, and even asserts
+  embedding-space sanity (`sim_db > 0.5`, `sim_unrelated < 0.25`, L2 norm ≈ 1) ✓. But note what it covers:
+  **pure functions only.** Zero tests for `recall`, `ingest`, `traverse`, `sweep_decay`, `resolve_uri`, the
+  `owner_uri` contract, the extension, the MCP handler, or the hydrator. Two of them are self-confirming
+  theater: `test_global_mesh_node_deduplication` re-implements the `HashSet::retain` dedupe *inside the test*
+  instead of calling `resolve_uri`, so it would pass even if you deleted the production line.
+  **The exact §1.1 bug class is 100% catchable by one test**: `assert_eq!(recall_after_ingest(nodes).len(), 1)`.
+- **No CI at all.** Zero workflows on both branches. So: nothing has ever been built on a clean machine,
+  `cargo fmt`/`clippy` never ran, `npm run build` for the frontend never ran in automation, no type-check gate
+  (and `ignoreBuildErrors: true` makes it moot), no extension lint (`mammoth`/`eslint-plugin-chrome-extension-api`),
+  no `actionlint`, no dependency audit, no release artifacts. `gh`/git show no PR history — single squashed commit.
+- **Observability:** no `tracing_subscriber::fmt::init()` despite the dependency; `println!` everywhere
+  (including in the async request path); no correlation/request IDs; no metrics endpoint; no OpenTelemetry;
+  no health deep-check (the `services` booleans just report `is_some()` on the client handle, i.e. "we built a
+  client", not "the DB is alive" — so `/health` reports **green while disconnected**). The extension and MCP log
+  to consoles nobody opens. For a product whose failure mode is silent no-op, that's the difference between a
+  bug report and a churn event. Add: `GET /v1/debug/trace?prompt=` returning the chosen nodes + why, and a
+  "why did I get no memory" panel in the popup/dashboard.
+- **Versioning chaos:** core `0.1.0` but `/health` says `version: "2.0"`; extension `1.0.0`; MCP `1.0.0`;
+  frontend `0.1.0`; desktop `0.1.0`; spec calls itself 2.0. No release process, no tags, no changelog.
+
+---
+
+## 10. The idea, honestly (you asked)
+
+**The problem is real and the instinct is right.** Context amnesia and cross-tool continuity are genuine,
+daily, self-reported pain, and "memory as a layer, not a feature" is a defensible thesis. Your specific
+architecture opinions are mostly *good* opinions: graph-of-triplets over raw-chunk RAG is the right call for
+identity/preferences; treating the vector store as a lookup front for the graph is correct and rare; the
+`cortex://` URI + JSON-LD packet as an exchange format is a real idea; local-first + a cheap async extraction
+model is the right cost curve; and putting a *visual* on memory is a genuine distribution insight — no one
+else makes their memory layer screenshot-worthy. Ebbinghaus-style salience weighting as a *ranking prior* is
+legit. You clearly read widely and thought it through.
+
+**Where I'd push back hard:**
+
+1. **Biological decay is a marketing metaphor you accidentally implemented as a data-loss feature.** Auto-deleting
+   a user's facts because `R < 0.05` is *negative* product value: users tolerate imperfect recall, never
+   tolerated silent forgetting — that's why ChatGPT memory is append/edit-only and why Notion AI never "forgets"
+   a page. Worse, in your implementation decay doubles as a **security** problem (§1.1: it deletes nothing but
+   reports pruning) and as a trust hole ("did it forget my password policy because I didn't mention it for 6
+   weeks?"). **Demote decay to scoring:** prune nothing; rank everything; surface a "fading" visual; make
+   deletion an explicit, previewed, undoable user action. You keep 100% of the aesthetic and none of the risk.
+2. **"O(1) memory / flat cost forever" is overclaimed physics.** Compression is lossy and *you pay for the
+   compressor*: extraction runs an LLM over your entire transcript stream. Your own `idea_validation.md` table
+   assumes 1M tokens/mo for an "extreme power user"; a heavy Cursor+ChatGPT+Claude user realistically ships
+   10–50M tokens/mo into extraction, and you re-extract per session, forever. Then add per-tenant Qdrant +
+   SurrealDB + Dragonfly: three stateful stores/user is **not $9/mo** on managed infra (~$40–120+/mo), so
+   the "99% margin" line only survives if you rewrite for shared, multi-tenant storage — a real project.
+   Realistic gross margin for a hosted v1: **60–75%**, and you should decide *deliberately* whether v1 is
+   self-host-only (then the paywall must be features, not storage) or multi-tenant SaaS (then re-architect).
+3. **You're not first, and speed matters more than the moat.** `cortex-mcp` (npm, Feb 2026) already shipped
+   persistent memory for coding assistants with git-hook capture. Mem0, Zep, Letta/MemGPT, Supermemory,
+   LangMem, and the platform vendors themselves (Claude Code memory + `CLAUDE.md` + auto-memory; ChatGPT/Claude
+   project memory; OpenAI's Assistants Files) all occupy adjacent ground, and — the hard one — **the platform's
+   own memory keeps getting better for free.** Your defensible edge is *portability across vendors* + *the graph
+   being inspectable/editable by the user* + *the visual*. That's a wedge, not a moat; it's winnable but it's a
+   distribution race, not a "build it and they come" architecture race.
+4. **The extension is your highest-value surface and your highest-fragility surface.** Rewriting the request body
+   of ChatGPT/Claude violates neither law nor physics but *does* conflict with platform ToS around automation and
+   is one obfuscated-JSON change away from breaking every user simultaneously (your Claude matcher already looks
+   dead, §3.4). You also can't ship memory into the ChatGPT **desktop app** or mobile apps at all. Treat the
+   extension as a fragile bonus, and make **MCP + IDE + CLI/SDK** the load-bearing spine.
+5. **"Universal protocol" needs a second implementer to exist.** A protocol with one client is a product. If you
+   want the protocol story, publish `cortex.schema.json`, ship a reference server that runs in **one binary with
+   zero DBs** (SurrealDB embedded/in-memory, no Qdrant — swap to your local embedding fallback + a small HNSW
+   lib), and a `cortex-derive`-style spec repo. That's how SQLite won, not how a Kafka clone wins.
+
+**What I'd cut, and what I'd double down on.**
+Cut for v1: cloud sync/CRDT, global mesh, browser extension for Claude+Gemini, Tauri app, iOS keyboard, mobile
+Safari, crawler, enterprise "steal our protocol" tier, three DBs.
+Double down for v1: `cortex-core` as **one static binary, one file, zero deps**; MCP with
+`remember/recall/forget/lock/stats`; a `cortex init` CLI that is the *only* installer and self-writes IDE configs
+by path+merge; a *readable, editable, exportable* memory browser (the product is trust, not retrieval); and the
+3D brain with **real** data + share-image export as the growth loop.
+
+**Money potential.** Honest ranges, no cheerleading:
+- *As specced today* (all surfaces, cloud, mobile, OS): 5+ FTE-years, and you should not attempt it solo.
+- *MCP + local single-user + honest dashboard* (the 35% that gets you revenue): **3–5 weeks of focused work.**
+  Then realistic solo-dev-tool economics: 300–3,000 installs in year 1 from HN/PH/X, 1–3% paid conversion →
+  **$0.5k–5k MRR**, long-tailed, with a real (maybe 1-in-10) shot at $20–50k MRR if you become the default
+  Cursor/Claude memory and hold the `@cortex` namespace. `10,000 users = $90k/mo` in `idea_validation.md` is
+  ~4–6 years of distribution *or* one viral integration — it is not a build problem.
+- **Where the actual money is:** agent builders and small teams paying for *shared, inspectable, portable*
+  memory with an audit trail (that's a $99–999/mo line item, not $8), and data-egress/portability narratives for
+  regulated shops. B2C $8/mo for a memory layer is the hardest possible price point in this category in 2026.
+- **MoM right now:** undefined, because MoM = installs × activation × retention, and the product cannot yet
+  *activate* (it stores memories and never retrieves them, §1.1). Fix that one bug and your MoM curve starts
+  existing. Until then the honest MoM is 0% and the honest "how far" number is **~12–15% to the vision,
+  ~65% to a shippable MCP beta.**
+
+---
+
+## 11. Do these 10 things, in this order
+1. **Merge `landing-site` → `main` (or delete `main`'s stub).** Stop shipping a broken repo to every visitor. *(1 h)*
+2. **Fix the ID/`owner_uri` contract** so ingest→recall→sweep share one key convention; normalize in `MemoryNode::new`. *(2–3 d, do it first — everything else is untestable until then)*
+3. **Add the 4 integration tests that would have caught #2** — `ingest → recall` returns the node; `sweep` actually deletes; `resolve` filters by owner; a dedupe test that calls production code. *(1 d)*
+4. **Bind core to `127.0.0.1`, remove `allow_origin(Any)`, enforce `api_key`, add timeout + body limit + real error responses.** *(1 d)*
+5. **Register and own the names before publishing:** npm `@cortex/*` scope (or rename), PyPI scoped package, a domain, a quick trademark search. **Decide AGPL vs permissive now, while you have 0 contributors.** *(1–2 d)*
+6. **Make install real:** `cortex init` (a 300-line Rust or Node CLI) that detects Cursor/Claude Desktop/Windsurf, **merges** JSON configs (never overwrites), writes an absolute path to an installed artifact, runs `npm install`, health-checks the port, and prints what it did + `--uninstall`. Ship it as `npx -y @cortex/init`. Kill `docker compose` from the README. *(3–5 d)*
+7. **Replace every fabricated UI state with a real one:** delete `DEMO_NEURONS`/`INITIAL_DEMO_NODES`/the seeded log; render a designed empty state ("0 memories — run the Hydrator") and a labeled `DEMO` badge on anything canned; never show `Simulator/Synthesized` for a failure — show `FAILED · why · retry`. *(2–3 d)*
+8. **Extension → reviewable:** icons + `minimum_chrome_version` + `version.json`, a per-turn "memory injected ✓/✗" indicator, a popup with a global pause + per-site toggle + a live list of stored memories with delete, real Claude matcher, drop assistant-reply ingestion (or gate it), debounce the observer, and CWS privacy disclosures. *(1–2 wk, and get the store listing text reviewed)*
+9. **Monetization spine:** Clerk (or Auth.js) + one Stripe Checkout + a webhook + entitlements on `owner_uri`, a real "delete everything / export JSON-LD" in settings (also satisfies the privacy policy), `metadataBase` + OG image. *(1 wk)*
+10. **Copy pass:** replace every 0ms/100%/99% claim with a measured number from the §15 test; move the profanity to `/nerd-yapping`; make the hero a working 20-second demo (store a fact → recall it) instead of canned dialogue. *(2 d)*
+
+**Then** the 6-week version: shared-storage multi-tenant cloud, real sync, `forget/lock/stats` tools, `@cortex/sdk`
+with `recall()`, and a public `cortex.schema.json`.
