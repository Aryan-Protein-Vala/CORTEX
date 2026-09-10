# cortex-js

CORTEX core client for TypeScript / JavaScript. No dependencies, works in Node 18+,
Bun, Deno and browsers.

```bash
cd cortex-js && npm install && npm run build
# in your project:
npm install file:../cortex-js
```

> `cortex-js` is not published on npm yet. `npm install cortex-js` would fetch
> somebody else's package; install from this repo (or claim the name first — see
> the release checklist in the repository root's `AGENTS.md`).

```ts
import { Cortex, CortexError } from "cortex-js"

const cortex = new Cortex({
  url: process.env.CORTEX_API_URL ?? "http://127.0.0.1:3030",
  apiKey: process.env.CORTEX_API_KEY, // only needed if the core has a key
  owner: "cortex://me", // your namespace; the core normalises it
})

// Store durable facts. `wait: true` blocks until extraction finishes and returns
// the report, so you can tell "nothing durable found" from "queued".
const { result } = await cortex.remember("we ship from main behind a feature flag", {
  source: "ci-bot",
  wait: true,
})
console.log(result?.triplets_extracted, result?.extractor, result?.warnings)

// Recall the exact context block a model would receive, retrying only on 429.
async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (error instanceof CortexError && error.status === 429 && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
}

const { briefing, memories_found, truncated, tokens_used } = await withRetry(() =>
  cortex.recall("what is our branching rule?", { tokenBudget: 400 })
)

console.log(briefing || "CORTEX has nothing relevant yet — that is a real answer, not a failure")
console.log({ memories_found, tokens_used, truncated })
```

## API

| Method | Core endpoint | Notes |
| --- | --- | --- |
| `remember(text, { owner?, source?, impact?, wait? })` | `POST /v1/ingest` | `wait: true` returns the `IngestReport` inline |
| `recall(prompt, { owner?, tokenBudget?, maxHops?, includeMesh?, explain? })` | `POST /v1/recall` | budget-enforced briefing + match counts |
| `resolveGraph(uri, { includeMesh?, tokenBudget? })` | `GET /v1/resolve` | the `cortex://` protocol view (JSON-LD packet) |
| `listMemories({ owner?, limit?, query?, includeMesh? })` | `GET /v1/memories` | nodes + edges, retention included |
| `forget(nodeId)` | `DELETE /v1/memories/:id` | the only deletion primitive |
| `lock(nodeId, locked?)` | `POST /v1/memories/:id/lock` | amygdala lock = exempt from decay |
| `stats()` / `health()` | `GET /v1/stats` · `GET /health` | `health()` tells you whether extraction and the vector accelerator are actually on |
| `job(id)` / `awaitJob(id, { timeoutMs? })` | `GET /v1/jobs/:id` | for queued ingests (`wait: false`) |
| `publishToMesh(nodes, edges)` | `POST /v1/mesh/publish` | gated by the core: expect `501 mesh_publish_disabled` until it has moderation |

`getGraph()` and `injectMemory()` still exist as thin aliases for the older snippets.

## Errors

Everything non-2xx throws `CortexError` with `status`, the core's `code`, the core's
`message`, and a `hint` that names the env var or command to fix it — so a 401 in
your agent says "the key does not match the core's `CORTEX_API_KEY`" instead of
`Cortex API error: Unauthorized`.

## Verify

```bash
npm run check      # tsc --noEmit (strict) + 9 contract tests against a stub core
npm run build      # dist/index.js (ESM), dist/index.cjs (CJS), .d.ts types
```

The tests assert the real wire shape — header names, `owner`/`prompt`/`wait` keys,
URL-encoding of node ids, job polling, and the 401/unreachable mappings — because an
SDK that drifts from the core is invisible until someone's agent stops remembering.

## Licence

AGPL-3.0-or-later, like the rest of this repository.
