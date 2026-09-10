"""
CORTEX core client (Python 3.9+, standard library only).

Deliberately dependency-free: a local-first memory tool should not need `pip
install requests` before it can talk to the binary on your own machine. The
previous version depended on `requests`, returned bare dicts, swallowed error
bodies, and offered no way to recall — which is the entire point of the product.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence

DEFAULT_URL = "http://127.0.0.1:3030"
DEFAULT_OWNER = "cortex://default"


class CortexError(RuntimeError):
    """Non-2xx responses and transport failures, with the core's own code."""

    def __init__(self, message: str, status: int = 0, code: str = "", hint: Optional[str] = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.hint = hint

    def __str__(self) -> str:  # pragma: no cover - debugging nicety
        base = super().__str__()
        return f"{base} (hint: {self.hint})" if self.hint else base


def _hint(status: int, code: str) -> Optional[str]:
    if status == 401:
        return "the key does not match the core's CORTEX_API_KEY"
    if status == 403:
        return "this core only accepts loopback clients unless CORTEX_API_KEY is set"
    if status == 429:
        return "rate limited; raise CORTEX_RATE_LIMIT_PER_MIN or back off"
    if status == 501:
        return "this capability is intentionally unimplemented in the current build"
    if status == 503:
        return "the core reported a missing backing service; see the message"
    if code in ("network", "timeout"):
        return "is the core running? `cd cortex-core && cargo run --release --bin cortex-core`"
    return None


@dataclass
class IngestReport:
    triplets_extracted: int = 0
    triplets_rejected: int = 0
    nodes_upserted: int = 0
    nodes_new: int = 0
    edges_upserted: int = 0
    edges_new: int = 0
    extractor: str = ""
    warnings: List[str] = field(default_factory=list)
    owner_uri: str = ""

    @property
    def stored(self) -> bool:
        return self.triplets_extracted > 0


@dataclass
class RecallResult:
    briefing: str
    token_budget: int = 0
    tokens_used: int = 0
    memories_found: int = 0
    truncated: bool = False
    scanned: int = 0
    owner_uri: str = ""
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)
    debug: List[Dict[str, Any]] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.briefing.strip())

    def __str__(self) -> str:  # pragma: no cover
        return self.briefing


@dataclass
class Health:
    status: str
    backend: str
    version: str = ""
    decay_policy: str = ""
    authenticated: bool = False
    services: Dict[str, bool] = field(default_factory=dict)
    counts: Dict[str, int] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def reachable(self) -> bool:
        return self.status in ("ok", "degraded")

    @property
    def extraction_enabled(self) -> bool:
        return bool(self.services.get("extraction"))

    @property
    def cloud_sync(self) -> bool:
        # The core reports this honestly; so do we.
        return bool(self.services.get("cloud_sync"))


class Cortex:
    """Talks to a CORTEX core. One owner namespace by default, overridable per call."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        owner: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("CORTEX_API_KEY") or ""
        url = base_url or os.environ.get("CORTEX_API_URL") or DEFAULT_URL
        self.base_url = url.rstrip("/")
        self.owner = owner or os.environ.get("CORTEX_OWNER") or DEFAULT_OWNER
        self.timeout = timeout

    # ----------------------------------------------------------------- plumbing

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        query = {k: v for k, v in (params or {}).items() if v not in (None, "", False)}
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

        data = None
        headers = {"accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        if self.api_key:
            headers["x-cortex-key"] = self.api_key
            headers["authorization"] = f"Bearer {self.api_key}"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload.strip() else None
        except urllib.error.HTTPError as error:  # 4xx/5xx: keep the core's message
            payload = error.read().decode("utf-8", "replace")
            code = f"http_{error.code}"
            message = payload[:400]
            try:
                parsed = json.loads(payload) if payload.strip() else {}
                err = parsed.get("error") or {}
                code = err.get("code") or code
                message = err.get("message") or message
            except json.JSONDecodeError:
                pass
            raise CortexError(f"{error.code} {code}: {message}", error.code, code, _hint(error.code, code)) from None
        except urllib.error.URLError as error:
            reason = getattr(error, "reason", error)
            is_timeout = type(reason).__name__ in ("timeout", "TimeoutError") or "timed out" in str(reason).lower()
            code = "timeout" if is_timeout else "network"
            message = (
                f"the core did not answer within {self.timeout}s"
                if is_timeout
                else f"could not reach the core at {self.base_url}: {reason}"
            )
            raise CortexError(message, 0, code, _hint(0, code)) from None
        except TimeoutError as error:  # pragma: no cover - socket-level timeout
            raise CortexError(f"the core did not answer within {self.timeout}s", 0, "timeout", _hint(0, "timeout")) from error

    # ------------------------------------------------------------------- verbs

    def health(self) -> Health:
        raw = self._request("GET", "/health") or {}
        return Health(
            status=raw.get("status", "unreachable"),
            backend=raw.get("backend", ""),
            version=raw.get("version", ""),
            decay_policy=raw.get("decay_policy", ""),
            authenticated=bool(raw.get("authenticated", False)),
            services=raw.get("services") or {},
            counts=raw.get("counts") or {},
            raw=raw,
        )

    def stats(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/stats") or {}

    def remember(
        self,
        text: str,
        owner: Optional[str] = None,
        *,
        source: str = "sdk",
        impact: Optional[int] = None,
        wait: bool = True,
    ) -> Dict[str, Any]:
        """Store durable facts. Returns the core's report (or a job id when wait=False)."""
        if not text or not text.strip():
            raise ValueError("remember() needs non-empty text")
        payload: Dict[str, Any] = {
            "owner": owner or self.owner,
            "prompt": text,
            "source": source,
            "wait": wait,
        }
        if impact is not None:
            # `impact` is the core's field name; it acts as a floor, never a ceiling.
            payload["impact"] = max(0, min(10, int(impact)))
        return self._request("POST", "/v1/ingest", body=payload) or {}

    def remember_report(self, text: str, owner: Optional[str] = None, **kwargs: Any) -> IngestReport:
        """`remember()` flattened into a dataclass, for code that branches on it."""
        result = self.remember(text, owner, **{**kwargs, "wait": True})
        raw = result.get("result") or {}
        return IngestReport(
            triplets_extracted=int(raw.get("triplets_extracted", 0)),
            triplets_rejected=int(raw.get("triplets_rejected", 0)),
            nodes_upserted=int(raw.get("nodes_upserted", 0)),
            nodes_new=int(raw.get("nodes_new", 0)),
            edges_upserted=int(raw.get("edges_upserted", 0)),
            edges_new=int(raw.get("edges_new", 0)),
            extractor=str(raw.get("extractor", "")),
            warnings=list(raw.get("warnings") or []),
            owner_uri=str(raw.get("owner_uri", "")),
        )

    def recall(
        self,
        prompt: str,
        owner: Optional[str] = None,
        *,
        token_budget: Optional[int] = None,
        max_hops: Optional[int] = None,
        include_mesh: bool = False,
        explain: bool = False,
    ) -> RecallResult:
        """The exact context block a model would be given, with match metadata."""
        payload: Dict[str, Any] = {
            "owner": owner or self.owner,
            "prompt": prompt,
            "include_mesh": include_mesh,
            "explain": explain,
        }
        if token_budget is not None:
            payload["token_budget"] = int(token_budget)
        if max_hops is not None:
            payload["max_hops"] = int(max_hops)
        raw = self._request("POST", "/v1/recall", body=payload) or {}
        return RecallResult(
            briefing=raw.get("briefing", ""),
            token_budget=int(raw.get("token_budget", 0)),
            tokens_used=int(raw.get("tokens_used", 0)),
            memories_found=int(raw.get("memories_found", 0)),
            truncated=bool(raw.get("truncated", False)),
            scanned=int(raw.get("scanned", 0)),
            owner_uri=raw.get("owner_uri", ""),
            nodes=list(raw.get("nodes") or []),
            edges=list(raw.get("edges") or []),
            debug=list(raw.get("debug") or []),
        )

    def resolve_graph(self, uri: str, *, include_mesh: bool = False, token_budget: Optional[int] = None) -> Dict[str, Any]:
        """The cortex:// protocol view (JSON-LD context packet)."""
        return self._request(
            "GET",
            "/v1/resolve",
            params={"uri": uri, "include_mesh": "true" if include_mesh else None, "token_budget": token_budget},
        ) or {}

    # Back-compat with the snippets that shipped first.
    def get_graph(self, uri: str, include_mesh: bool = False) -> Dict[str, Any]:
        return self.resolve_graph(uri, include_mesh=include_mesh)

    def inject_memory(self, uri: str, text: str, source: str = "sdk") -> Dict[str, Any]:
        return self._request("POST", "/v1/inject", body={"uri": uri, "text": text, "source": source}) or {}

    def list_memories(
        self,
        owner: Optional[str] = None,
        *,
        limit: Optional[int] = None,
        query: Optional[str] = None,
        include_mesh: bool = False,
    ) -> Dict[str, Any]:
        return self._request(
            "GET",
            "/v1/memories",
            params={
                "owner": owner or self.owner,
                "limit": limit,
                "q": query,
                "include_mesh": "true" if include_mesh else None,
            },
        ) or {}

    def memories(self, owner: Optional[str] = None, **kwargs: Any) -> Sequence[Dict[str, Any]]:
        return list(self.list_memories(owner, **kwargs).get("memories") or [])

    def forget(self, node_id: str) -> Dict[str, Any]:
        """Delete one memory and its edges. Nothing in CORTEX deletes anything else silently."""
        return self._request("DELETE", f"/v1/memories/{urllib.parse.quote(node_id, safe='')}") or {}

    def lock(self, node_id: str, locked: bool = True) -> Dict[str, Any]:
        """Amygdala lock: exempt from decay forever. `locked=False` lets decay fade it again."""
        return self._request("POST", f"/v1/memories/{urllib.parse.quote(node_id, safe='')}/lock", body={"locked": locked}) or {}

    def job(self, job_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/v1/jobs/{urllib.parse.quote(job_id, safe='')}") or {}

    def await_job(self, job_id: str, *, timeout: float = 60.0, interval: float = 0.5) -> Dict[str, Any]:
        import time

        deadline = time.monotonic() + timeout
        while True:
            job = self.job(job_id)
            if job.get("state") in ("done", "failed", "error"):
                return job
            if time.monotonic() > deadline:
                raise CortexError(
                    f"job {job_id} still {job.get('state', 'unknown')} after {timeout}s",
                    408,
                    "job_timeout",
                    "check whether the core's extraction LLM call is hanging",
                )
            time.sleep(interval)

    def publish_to_mesh(self, nodes: Iterable[Dict[str, Any]], edges: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        """Gated by the core: expect CortexError(501, 'mesh_publish_disabled') until it has moderation."""
        return self._request("POST", "/v1/mesh/publish", body={"nodes": list(nodes), "edges": list(edges)}) or {}
