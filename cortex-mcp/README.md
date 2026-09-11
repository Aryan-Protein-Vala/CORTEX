# CORTEX MCP server

Gives Cursor, Claude Desktop, Windsurf (anything that speaks MCP over stdio) a
persistent memory that survives restarts, chats and machines. It is a thin, honest
client for the local `cortex-core` engine — no account, no cloud, no telemetry.

```
you type:  "always use pnpm here, npm broke CI twice"
model does: cortex_remember → core stores  User -[uses]-> pnpm  (impact 10, locked-worthy)
next week:  cortex_recall before answering  →  the rule comes back in ~40 tokens
```

## What you get

Nine tools. Two of them (`cortex_forget`, `cortex_lock`) accept a label instead of
an opaque id, because that is what a model actually knows; an ambiguous label is
reported rather than guessed.

| Tool | Purpose |
| --- | --- |
| `cortex_recall` | Budgeted briefing of the facts/rules that apply to the current question. Call it before answering anything about their stack or project. |
| `cortex_remember` | Store one durable fact. Waits for the engine and reports how many triplets/nodes/edges were created — or that nothing was durable enough to store. |
| `cortex_remember_turn` | Buffer a conversation turn (user *or* assistant). Extraction runs once per session, not once per message. |
| `cortex_resolve` | Read a whole `cortex://` namespace as a JSON-LD packet. |
| `cortex_forget` | Delete one node and the edges that referenced it, by `node_id` or exact `label`. Marked `destructiveHint`, so clients can ask first. |
| `cortex_lock` | Pin (or unpin) a memory so the decay sweep can never fade it — by `node_id` or `label`. |
| `cortex_expand` | One memory plus the edges and neighbours around it: the local graph, when a briefing names something whose relationships matter. |
| `cortex_ingest_project_files` | Extract conventions from `AGENTS.md`/`README.md`/manifests — only inside `CORTEX_READ_DIRS`, never a symlink escape, secrets redacted on read. |
| `cortex_status` | Reachability, backend, counts and resolved config. Paste this when something looks broken. |

No tool ever returns a success it did not get: a core that is down, a key that was
rejected, a 404 on an invented id and an ambiguous label all come back as `isError`
or an explicit `found: false`, so the model says "I could not reach memory" instead
of inventing one.

Plus two resources (`cortex://profile`, `cortex://stats`) and server
`instructions`, which is what actually makes a capable client call `recall`
without being told to every time.

## Setup

Two processes: the core (the database) and this server (the protocol adapter).

**1. Run the core**

```bash
cd ../cortex-core
cargo run --release --bin cortex-core
# →  listening on http://127.0.0.1:3030, storage file ~/.cortex/cortex-graph.json
```

No API key needed: bound to loopback it is usable by you alone. Add
`CORTEX_API_KEY=...` if it must listen elsewhere.

**2. Register the MCP server** (`~/.cursor/mcp.json`, or Claude Desktop's config,
or Settings → MCP in Windsurf):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/CORTEX/cortex-mcp/index.js"],
      "env": {
        "CORTEX_API_URL": "http://127.0.0.1:3030",
        "CORTEX_OWNER": "cortex://me"
      }
    }
  }
}
```

`setup-cursor-mcp.sh` in the repo root writes this for you (merging with any
existing servers) and installs the npm dependencies first.

> **Do not `npx -y cortex-mcp`.** That name on npm belongs to an unrelated
> third-party package; same for `pip install cortex-sdk`. Until this project
> publishes under a name it owns, install from the clone as above. See
> [`../FIXES.md`](../FIXES.md#naming).

## Configuration

| Env | Default | Effect |
| --- | --- | --- |
| `CORTEX_API_URL` | `http://127.0.0.1:3030` | Where the core listens. |
| `CORTEX_API_KEY` | _unset_ | Sent as `Authorization: Bearer …`. Required whenever the core has `CORTEX_API_KEY` set or is remote. |
| `CORTEX_OWNER` | `cortex://default` | Namespace your memory lives in. Use one per person/team, e.g. `cortex://team_eng`. |
| `CORTEX_TOKEN_BUDGET` | `500` | Ceiling for injected briefings. The core clamps it to its own max and says when it truncated. |
| `CORTEX_TIMEOUT_MS` | `20000` | Per-request timeout; extraction with an LLM can be slow. |
| `CORTEX_INCLUDE_MESH` | `off` | Also search the shared `cortex://global` mesh. Off by default. |
| `CORTEX_READ_DIRS` | _empty_ | Colon-separated allowlist for `cortex_ingest_project_files`. Empty = the tool refuses. |
| `CORTEX_MAX_FILE_BYTES` | `200000` | Per-file read cap for that tool. |

## Verifying it

```bash
npm install
npm run check     # syntax
npm run smoke     # 21 assertions against a stub core: recall/remember/flush/
                  # forget/allowlist/auth/error semantics — needs no network
```

If memory looks empty in a real client, call `cortex_status` — it distinguishes
"core down", "wrong key" and "genuinely no memories" instead of guessing.

## Privacy model

Everything stays on your machine: this process talks to `CORTEX_API_URL` only, and
the core writes only to its own data directory. Facts are extracted from **user**
turns, so model output never becomes a stored belief about you. `remember` refuses
nothing but never uploads raw chat logs — only the extracted triplets persist.
To audit or erase: `GET /v1/memories`, `DELETE /v1/memories/:id`, or stop the core
and delete `~/.cortex/`.

## Licence

AGPL-3.0-or-later, same as the rest of this repository.
