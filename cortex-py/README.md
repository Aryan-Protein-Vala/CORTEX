# cortex-py

CORTEX core client for Python 3.9+. **Standard library only** — no `requests`, no
install-time network fetches, because a local-first memory tool should be able to
talk to the binary on your own machine with nothing but Python.

```bash
pip install -e ./cortex-py       # from the repository root: pip install -e cortex-py
```

> Never `pip install cortex-sdk`: that PyPI name belongs to an unrelated project
> (published by "Nearly Human"), not to this repository. This package is
> `cortex-py` and is likewise not published yet — install from source, or claim
> the name via the release checklist in the repo root's `AGENTS.md`.

```python
import os
from cortex_py import Cortex, CortexError

cortex = Cortex(
    base_url=os.environ.get("CORTEX_API_URL", "http://127.0.0.1:3030"),
    api_key=os.environ.get("CORTEX_API_KEY"),   # only if the core has a key
    owner="cortex://me",                        # your namespace
)

# Store durable facts. wait=True returns the extraction report inline.
report = cortex.remember_report("we ship from main behind a feature flag", source="ci")
if not report.stored:
    print("nothing durable found:", report.warnings)

# Recall the exact block a model would receive.
result = cortex.recall("what is our branching rule?", token_budget=400)
print(result.briefing or "CORTEX has nothing relevant yet")
print(result.memories_found, result.tokens_used, "truncated" if result.truncated else "")

# Guard a long-lived process against a key that drifted.
try:
    cortex.stats()
except CortexError as error:
    if error.status == 401:
        raise SystemExit(f"fix CORTEX_API_KEY: {error.hint}")
    raise
```

## API

| Method | Core endpoint | Notes |
| --- | --- | --- |
| `remember(text, owner=None, *, source, impact, wait=True)` | `POST /v1/ingest` | raw report dict |
| `remember_report(...) -> IngestReport` | `POST /v1/ingest` | dataclass with `.stored`, `.triplets_extracted`, `.warnings` |
| `recall(prompt, owner=None, *, token_budget, max_hops, include_mesh, explain) -> RecallResult` | `POST /v1/recall` | truthy when the briefing is non-empty; `str(result)` is the briefing |
| `resolve_graph(uri, *, include_mesh, token_budget)` | `GET /v1/resolve` | the `cortex://` JSON-LD packet |
| `list_memories(...)` / `memories(...)` | `GET /v1/memories` | nodes + edges with retention |
| `forget(node_id)` | `DELETE /v1/memories/:id` | the only deletion primitive |
| `lock(node_id, locked=True)` | `POST /v1/memories/:id/lock` | decay-exempt forever / re-enable fading |
| `health()` / `stats()` | `GET /health` · `GET /v1/stats` | `health().extraction_enabled`, `health().cloud_sync` report real flags |
| `job(id)` / `await_job(id, *, timeout, interval)` | `GET /v1/jobs/:id` | for `wait=False` ingests |
| `publish_to_mesh(nodes, edges)` | `POST /v1/mesh/publish` | expect `CortexError(501, "mesh_publish_disabled")` until the core has moderation |

`get_graph()` and `inject_memory()` remain as aliases for the earlier snippets.

## Errors

Every non-2xx response and transport failure raises `CortexError` carrying
`status`, the core's `code`, its `message`, and a `hint` naming the env var or
command that fixes it. `code == "network"` means the core was not reachable at all
— distinct from an empty recall, which is a normal answer.

## Tests

```bash
cd cortex-py && python3 -m unittest discover -s tests -t .
```

Ten contract checks run against an in-process stub core and assert the wire shape:
header names, `owner`/`prompt`/`wait`/`impact_floor` keys, URL-encoded node ids,
typed `RecallResult`/`IngestReport` mapping, the 401 hint, and the unreachable-core
path. No third-party packages needed to run them.

## Licence

AGPL-3.0-or-later, like the rest of this repository.
