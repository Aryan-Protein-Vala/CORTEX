# Security Policy

CORTEX stores what you tell your AI: preferences, decisions, project context, sometimes
health or family details that slipped into a work conversation. That is the threat model of
this whole project, so this page is written at that level of seriousness rather than as boilerplate.

## What "local-first" does and does not mean

**It does mean:**

- The core binds to `127.0.0.1` and refuses to start on a routable interface unless you set
  `CORTEX_API_KEY`. There is no "insecure default you should fix later".
- Your memory is one file (`~/.cortex/cortex-graph.json`). No account, no telemetry, no update
  ping, no analytics in the core, MCP server, SDKs or extension.
- Nothing is sent to a third party unless you configure it: extraction calls OpenRouter only when
  `OPENROUTER_API_KEY` is set, and `/health` reports `extraction: false` when it is not.
- Mesh publishing is disabled in code (`501`), not by a checkbox that defaults to on.

**It does not mean:**

- **The file on disk is not encrypted.** Anyone with your user account, a stolen laptop without full
  disk encryption, or a backup service reading your home directory can read your entire memory graph
  in plain text. That is a deliberate trade-off (a readable file is also an auditable one) and the
  mitigation is yours to own: FileVault/BitLocker/LUKS, and `chmod 600 ~/.cortex` if others share the
  machine. A keyring-backed encrypted store is planned, not shipped.
- **Anything you expose with a key is a real network service.** With `CORTEX_API_KEY` set, the core
  accepts cross-origin requests from `CORTEX_ALLOWED_ORIGINS`, so treat that key like a password:
  env var or editor config, never a URL.
- **The key is accepted in three places, and one of them is a bad idea.** `Authorization: Bearer`,
  `x-cortex-key` and `?key=` all work — `?key=` exists so a browser can open the WebSocket without a
  custom header. Query strings end up in proxy logs, shell history and browser history. Use a header.
- **A rate limiter is not an ACL.** `CORTEX_RATE_LIMIT_PER_MIN` (default 240/IP) blunts abuse; a
  leaked key reads and writes everything in an owner namespace. There is no per-user isolation
  beyond the `owner` string, and no per-owner permissions. Multi-tenant deployments are not what this
  is for.

## The one risk that is specific to memory systems

**Recalled memory is injected into a model's context, so a poisoned memory is a durable
prompt injection.** If an attacker can get text into your graph, they can influence what every AI
you use later reads. Mitigations in code today:

- Only **user turns** are extracted into facts; `ASSISTANT`/`SYSTEM`/`TOOL` lines are skipped
  (`ai::heuristic_triplets`), so a page that impersonates the assistant does not become your memory.
- The browser extension is read-only by default and **per-origin consent-gated**; nothing is captured
  before you click "Allow for this site", and nothing is sent anywhere until you type a core URL.
- The MCP server scrubs obvious secrets (API keys, tokens, `Bearer …`) before storage and reports
  how much it removed.
- Deletion is cheap and explicit: `cortex_forget`, the brain view's trash action, or
  `DELETE /v1/memories/{id}`; locked memories are exempt from decay under every policy.

Not mitigated: an attacker who can post as *you* in a chat you harvest still writes memories as you.
Treat imported/harvested content as untrusted input, and lock the facts that matter.

## Request limits, and what they protect

Request bodies cap at 2 MiB, extraction calls time out at 30 s, concurrent jobs are bounded by
`CORTEX_MAX_CONCURRENT_JOBS` (permit acquired before the job spawns, so a burst cannot queue
unbounded work), and the token budget for a briefing is clamped server-side by
`CORTEX_MAX_TOKEN_BUDGET`. These cap amplification, not malice: an authenticated caller can still
fill your disk. `~/.cortex` is not a place to point at a small partition.

## Reporting a vulnerability

Prefer a **private vulnerability report**:
<https://github.com/Aryan-Protein-Vala/CORTEX/security/advisories/new>

If that page is not available to you, open an issue titled exactly `security` with no details in the
body and I will follow up in a private channel — that keeps the description out of a public search
index while we get somewhere safe to talk.

This is a solo, unincorporated, unfunded project, so please be realistic about expectations: no
SLA, no bug bounty, no paid triage. What you get instead is a fast human answer, a fix with a
regression test in the same change, and credit in the release notes if you want it.

## Hardening checklist for anyone running this outside a laptop

1. Set `CORTEX_API_KEY` to a real random value (`openssl rand -hex 24`) and pass it via header only.
2. Set `CORTEX_ALLOWED_ORIGINS` to the exact origins that need it — do not use `*`.
3. Run the core behind TLS you terminate properly (reverse proxy), never exposed raw.
4. Keep `CORTEX_ALLOW_MESH_PUBLISH` unset; publishing to a shared mesh has no moderation today.
5. Snapshot `~/.cortex` with a backup tool that encrypts, and test a restore once — an export
   endpoint nobody restores is not a backup.
6. Rotate the key if it ever appears in a URL, a shell history file, or a committed config.
7. Run `cargo test` in `cortex-core` after any change: the auth matrix, owner isolation and body-cap
   behaviour are asserted in `tests/api_contract.rs`.
