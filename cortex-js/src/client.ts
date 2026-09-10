/**
 * CORTEX core client for Node.js, Deno, Bun and browsers.
 *
 * Zero dependencies, and it speaks the API the Rust core actually serves (see
 * `cortex-core/src/api/server.rs`): the previous version hand-rolled a
 * `{ uri, text }` inject call that matched nothing else in the docs, could not
 * read an error body, and had no way to recall anything — the one thing this
 * product is for.
 */

export interface CortexConfig {
  /** Core URL. Defaults to CORTEX_API_URL, then http://127.0.0.1:3030. */
  url?: string
  /** Deprecated alias for `url`. */
  baseUrl?: string
  /** Matches the core's CORTEX_API_KEY. Optional when the core is loopback-only. */
  apiKey?: string
  /** Default owner namespace for remember()/recall(). */
  owner?: string
  /** Per-request timeout. The core's own extraction timeout is longer than 5s. */
  timeoutMs?: number
  /** Bring your own fetch (tests, proxies). */
  fetchImpl?: typeof fetch
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

export interface RememberResult {
  accepted: boolean
  job_id: string
  status?: string
  result?: IngestReport
}

export interface RecallOptions {
  owner?: string
  tokenBudget?: number
  maxHops?: number
  includeMesh?: boolean
  explain?: boolean
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
  nodes: MemoryNode[]
  edges: MemoryEdge[]
  debug?: { node: MemoryNode; score: number; why: string[] }[]
}

export interface MemoryNode {
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

export interface MemoryEdge {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
  is_historical: boolean
  impact: number
  locked: boolean
}

export interface CoreStats {
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

export interface CoreHealth {
  status: string
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
  counts: { nodes: number; edges: number; pending_jobs: number; buffered_sessions: number }
}

/** Every failure carries the core's own code and a hint that is actionable. */
export class CortexError extends Error {
  readonly status: number
  readonly code: string
  readonly hint?: string

  constructor(message: string, status: number, code: string, hint?: string) {
    super(message)
    this.name = "CortexError"
    this.status = status
    this.code = code
    this.hint = hint
  }
}

function hintFor(status: number, code: string): string | undefined {
  if (status === 401) return "The key does not match the core's CORTEX_API_KEY."
  if (status === 403) return "This core only accepts loopback clients unless CORTEX_API_KEY is set."
  if (status === 429) return "Rate limited by the core; raise CORTEX_RATE_LIMIT_PER_MIN or back off."
  if (status === 501) return "This capability is intentionally unimplemented in the current build."
  if (status === 503) return "Configure the backing service the core reported as missing."
  if (code === "network" || code === "timeout") return "Is the core running? `cd cortex-core && cargo run --release --bin cortex-core`"
  return undefined
}

export class Cortex {
  private readonly url: string
  private readonly apiKey: string
  private readonly owner: string
  private readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(config: string | CortexConfig = {}) {
    const input: CortexConfig = typeof config === "string" ? { apiKey: config } : config
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
    const base = input.url || input.baseUrl || env.CORTEX_API_URL || "http://127.0.0.1:3030"
    this.url = base.replace(/\/+$/, "")
    this.apiKey = input.apiKey || env.CORTEX_API_KEY || ""
    this.owner = input.owner || env.CORTEX_OWNER || "cortex://default"
    this.timeoutMs = input.timeoutMs ?? 30_000
    this.doFetch = input.fetchImpl ?? fetch.bind(globalThis)
  }

  get baseUrl(): string {
    return this.url
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value))
    }
    const suffix = query.toString() ? `?${query.toString()}` : ""
    const headers: Record<string, string> = { accept: "application/json" }
    // Both spellings on purpose: `x-cortex-key` survives proxies that reserve
    // Authorization, and the core accepts either.
    if (this.apiKey) {
      headers["x-cortex-key"] = this.apiKey
      headers.authorization = `Bearer ${this.apiKey}`
    }
    if (init.body !== undefined) headers["content-type"] = "application/json"

    let response: Response
    try {
      response = await this.doFetch(`${this.url}${path}${suffix}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const name = (error as Error)?.name ?? ""
      const timedOut = name === "TimeoutError" || name === "AbortError"
      throw new CortexError(
        timedOut ? `The core did not answer within ${this.timeoutMs}ms` : `Could not reach the core at ${this.url}`,
        0,
        timedOut ? "timeout" : "network",
        hintFor(0, timedOut ? "timeout" : "network")
      )
    }

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { raw: text.slice(0, 400) }
      }
    }

    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error ?? {}
      const code = error.code ?? `http_${response.status}`
      const message = error.message ?? (payload as { raw?: string } | null)?.raw ?? response.statusText ?? "request failed"
      throw new CortexError(`${response.status} ${code}: ${message}`, response.status, code, hintFor(response.status, code))
    }

    return payload as T
  }

  /** Store durable facts from free text. `wait: true` returns the extraction report. */
  async remember(text: string, options: { owner?: string; source?: string; impact?: number; wait?: boolean } = {}): Promise<RememberResult> {
    if (!text || !text.trim()) throw new CortexError("remember() needs non-empty text", 400, "empty_text")
    return this.request<RememberResult>("/v1/ingest", {
      body: {
        owner: options.owner ?? this.owner,
        prompt: text,
        source: options.source ?? "sdk",
        wait: options.wait ?? false,
        // The core's wire field is `impact`; it becomes an impact *floor* internally.
        ...(options.impact !== undefined ? { impact: options.impact } : {}),
      },
    })
  }

  /** The exact block a model would be given, plus why each memory matched. */
  async recall(prompt: string, options: RecallOptions = {}): Promise<RecallResult> {
    return this.request<RecallResult>("/v1/recall", {
      body: {
        owner: options.owner ?? this.owner,
        prompt,
        ...(options.tokenBudget !== undefined ? { token_budget: options.tokenBudget } : {}),
        ...(options.maxHops !== undefined ? { max_hops: options.maxHops } : {}),
        include_mesh: options.includeMesh ?? false,
        explain: options.explain ?? false,
      },
    })
  }

  /** Whole-namespace view via the cortex:// resolver. */
  async resolveGraph(uri: string, options: { includeMesh?: boolean; tokenBudget?: number } = {}): Promise<RecallResult & { context: string; user_id: string }> {
    return this.request("/v1/resolve", {
      query: {
        uri,
        include_mesh: options.includeMesh ? "true" : undefined,
        token_budget: options.tokenBudget,
      },
    })
  }

  /** @deprecated use resolveGraph(); kept so earlier snippets still run. */
  async getGraph(uri: string, includeMesh = false): Promise<RecallResult & { context: string; user_id: string }> {
    return this.resolveGraph(uri, { includeMesh })
  }

  /** @deprecated use remember(); this maps to the core's /v1/inject. */
  async injectMemory(uri: string, text: string, source = "sdk"): Promise<{ success: boolean; owner_uri: string; message: string; result: IngestReport }> {
    return this.request("/v1/inject", { body: { uri, text, source } })
  }

  async listMemories(options: { owner?: string; limit?: number; query?: string; includeMesh?: boolean } = {}): Promise<{ owner_uri: string; total: number; returned: number; memories: MemoryNode[]; edges: MemoryEdge[] }> {
    return this.request("/v1/memories", {
      query: {
        owner: options.owner ?? this.owner,
        limit: options.limit,
        q: options.query,
        include_mesh: options.includeMesh ? "true" : undefined,
      },
    })
  }

  /** Delete one memory and its edges. Nothing else in CORTEX deletes silently. */
  async forget(nodeId: string): Promise<{ deleted: boolean; node_id: string }> {
    return this.request(`/v1/memories/${encodeURIComponent(nodeId)}`, { method: "DELETE" })
  }

  /** Amygdala lock: exempt from decay forever. `locked: false` re-enables fading. */
  async lock(nodeId: string, locked = true): Promise<{ locked: boolean; label?: string }> {
    return this.request(`/v1/memories/${encodeURIComponent(nodeId)}/lock`, { body: { locked } })
  }

  async stats(): Promise<CoreStats> {
    return this.request("/v1/stats")
  }

  async health(): Promise<CoreHealth> {
    return this.request("/health")
  }

  async job(jobId: string): Promise<{ job_id: string; state: string; result?: unknown; error?: string }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`)
  }

  /** Poll a queued ingest to completion (bounded; the core also exposes /v1/jobs). */
  async awaitJob(jobId: string, { timeoutMs = 60_000, intervalMs = 500 } = {}): Promise<{ job_id: string; state: string; result?: unknown; error?: string }> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const job = await this.job(jobId)
      if (job.state === "done" || job.state === "failed" || job.state === "error") return job
      if (Date.now() > deadline) {
        throw new CortexError(`job ${jobId} still ${job.state} after ${timeoutMs}ms`, 408, "job_timeout", "Increase timeoutMs, or check whether the core's LLM call is hanging.")
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  /** Global mesh publishing is gated by the core; this reports the gate honestly. */
  async publishToMesh(nodes: unknown[], edges: unknown[]): Promise<{ published: number }> {
    return this.request("/v1/mesh/publish", { body: { nodes, edges } })
  }
}

export default Cortex
export { Cortex as Client }
