/**
 * Typed client for the CORTEX core.
 *
 * Every call goes through the same-origin `/api/core` proxy (see
 * `app/api/core/[...path]/route.ts`). That is deliberate: the browser must never
 * know the core's address or its key, and an https deployment calling
 * `http://localhost:3030` directly is blocked as mixed content — which is how
 * this dashboard ended up showing "offline" for everyone who was not running the
 * core on the same machine.
 */

export interface Health {
  status: "ok" | "degraded" | string
  version: string
  uptime_secs: number
  backend: string
  decay_policy: string
  authenticated: boolean
  services: {
    graph: boolean
    extraction: boolean
    vector_accelerator: boolean
    sessions: boolean
    cloud_sync: boolean
  }
  counts: {
    nodes: number
    edges: number
    pending_jobs: number
    buffered_sessions: number
  }
}

export interface Stats {
  version: string
  backend: string
  decay_policy: string
  nodes: number
  edges: number
  locked: number
  fading: number
  historical: number
  avg_retention: number
  by_category: Record<string, number>
  by_provenance: Record<string, number>
  top_labels: string[]
  full_graph_token_estimate: number
}

export interface MemoryDto {
  id: string
  label: string
  category: string
  impact: number
  stability: number
  weight_hint: number
  locked: boolean
  fading: boolean
  retention: number
  owner_uri: string
  provenance: string
  access_count: number
  last_accessed: string
  updated_at: string
}

export interface EdgeDto {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
  is_historical: boolean
  impact: number
  locked: boolean
}

export interface MemoryList {
  owner_uri: string
  total: number
  returned: number
  memories: MemoryDto[]
  edges: EdgeDto[]
}

export interface RecallResult {
  briefing: string
  token_budget: number
  tokens_used: number
  memories_found: number
  truncated: boolean
  scanned: number
  owner_uri: string
  node_count: number
  edge_count: number
  nodes: MemoryDto[]
  edges: EdgeDto[]
  debug?: { node: MemoryDto; score: number; why: string[] }[]
}

export interface IngestReport {
  triplets_extracted: number
  triplets_rejected: number
  nodes_upserted: number
  nodes_new: number
  edges_upserted: number
  edges_new: number
  extractor: string
  warnings: string[]
  owner_uri: string
}

export interface SweepReport {
  policy: string
  evaluated_nodes: number
  evaluated_edges: number
  faded_nodes: number
  depressed_edges: number
  pruned_nodes: number
  pruned_edges: number
  protected_nodes: number
}

export type CoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; offline: boolean; status: number; code: string; message: string }

const PROXY = "/api/core"

async function request<T>(path: string, init?: RequestInit): Promise<CoreResult<T>> {
  let response: Response
  try {
    response = await fetch(`${PROXY}${path}`, {
      cache: "no-store",
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    })
  } catch {
    return {
      ok: false,
      offline: true,
      status: 0,
      code: "proxy_unreachable",
      message: "The site could not reach its own API route. Reload once the dev server is up.",
    }
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { error: { code: `http_${response.status}`, message: text.slice(0, 180) } }
    }
  }

  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error ?? {}
    const code = error.code ?? `http_${response.status}`
    return {
      ok: false,
      // 503 + core_unreachable is the proxy's honest "my core is down" signal.
      offline: response.status === 503 && code === "core_unreachable",
      status: response.status,
      code,
      message: error.message ?? `Request failed with HTTP ${response.status}`,
    }
  }

  return { ok: true, data: parsed as T }
}

export const core = {
  health: () => request<Health>("/health"),
  stats: () => request<Stats>("/v1/stats"),
  memories: (query?: { limit?: number; q?: string; owner?: string; includeMesh?: boolean }) => {
    const params = new URLSearchParams()
    if (query?.limit) params.set("limit", String(query.limit))
    if (query?.q) params.set("q", query.q)
    if (query?.owner) params.set("owner", query.owner)
    if (query?.includeMesh) params.set("include_mesh", "true")
    const suffix = params.toString() ? `?${params.toString()}` : ""
    return request<MemoryList>(`/v1/memories${suffix}`)
  },
  recall: (body: { prompt: string; owner?: string; token_budget?: number; explain?: boolean; include_mesh?: boolean }) =>
    request<RecallResult>("/v1/recall", { method: "POST", body: JSON.stringify(body) }),
  ingest: (body: { prompt: string; owner?: string; source?: string; wait?: boolean; impact?: number }) =>
    request<{ accepted: boolean; job_id: string; result?: IngestReport }>("/v1/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  forget: (id: string) => request<null>(`/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  lock: (id: string, locked: boolean) =>
    request<{ locked: boolean; label?: string }>(`/v1/memories/${encodeURIComponent(id)}/lock`, {
      method: "POST",
      body: JSON.stringify({ locked }),
    }),
  sweep: () => request<SweepReport>("/v1/sweep", { method: "POST", body: "{}" }),
}

/** Copy that never pretends the data exists. */
export function describeFailure(result: { offline: boolean; code: string; message: string }): string {
  if (result.offline) {
    return "No core is connected. Start it with `cargo run --release --bin cortex-core`, then set CORTEX_API_URL for this site if it listens somewhere else."
  }
  if (result.code === "unauthorized" || result.code === "forbidden") {
    return "The core rejected this request. Set CORTEX_API_KEY in the site's environment to match the core's key."
  }
  if (result.code === "rate_limited") {
    return "The core is rate limiting this site. Wait a minute or raise CORTEX_RATE_LIMIT_PER_MIN."
  }
  return result.message
}
