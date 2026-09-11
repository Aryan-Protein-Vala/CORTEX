'use client'

import { useEffect, useState } from 'react'
import { Terminal, Copy, Check, Code2, Database, Puzzle, Globe2 } from 'lucide-react'
import { core } from '@/lib/core'

function CopyBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div style={{ border: '1px solid var(--border)', background: '#0a0a0a', marginTop: 20 }}>
      <div className="box-top" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <span>{lang.toUpperCase()}</span>
        <button
          onClick={handleCopy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, color: 'var(--secondary)', cursor: 'pointer', font: 'inherit' }}
        >
          {copied ? (
            <>
              <Check size={12} color="#22c55e" /> <span style={{ color: '#22c55e' }}>COPIED</span>
            </>
          ) : (
            <>
              <Copy size={12} /> COPY
            </>
          )}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 20, overflowX: 'auto', font: '13px/1.6 monospace', color: '#e5e7eb', whiteSpace: 'pre-wrap' }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

const ENV_ROWS: [string, string, string][] = [
  ['CORTEX_HOST / CORTEX_PORT', '127.0.0.1 / 3030', 'Bind address. A non-loopback bind refuses to start without an API key.'],
  ['CORTEX_API_KEY', 'unset', 'Required for remote clients. Clients send it as x-cortex-key or Authorization: Bearer.'],
  ['CORTEX_DATA_DIR', '~/.cortex', 'Where the JSON graph file (and mesh store) live. This is your database.'],
  ['CORTEX_ALLOWED_ORIGINS', 'localhost origins', 'CORS allowlist for browser clients (dashboard proxy, extension).'],
  ['CORTEX_TOKEN_BUDGET / CORTEX_MAX_TOKEN_BUDGET', '400 / 4000', 'Default and ceiling for a recall briefing, enforced in code.'],
  ['CORTEX_DECAY_POLICY', 'soft', 'soft = fade and stop injecting. prune = actually delete, opt-in only.'],
  ['CORTEX_SWEEP_INTERVAL_SECS', '3600', 'How often the forgetting curve is applied in the background.'],
  ['OPENROUTER_API_KEY', 'unset', 'Without it, extraction uses offline heuristics. /health tells you which one is live.'],
  ['CORTEX_SURREAL_URL (+ _USER/_PASS/_NS/_DB)', 'unset', 'Opt-in SurrealDB backend. Unset means the file store — no Docker needed.'],
  ['CORTEX_REQUIRE_SURREAL', 'false', 'true makes a missing SurrealDB a startup failure instead of a fallback.'],
  ['CORTEX_QDRANT_URL', 'unset', 'Opt-in vector accelerator. Unset means exact/graph recall only, never a fake embedding search.'],
  ['CORTEX_SESSION_IDLE_SECS / _MAX_MESSAGES', '45 / 60', 'Buffered-turns window for /v1/session/message (extension, MCP).'],
  ['CORTEX_RATE_LIMIT_PER_MIN / CORTEX_MAX_CONCURRENT_JOBS', '120 / 4', 'Per-IP guardrails and extraction concurrency.'],
  ['CORTEX_ALLOW_MESH_PUBLISH / CORTEX_MESH_PATH', 'false / unset', 'Global mesh publishing stays 501 until moderation and opt-in exist.'],
  ['CORTEX_DEFAULT_OWNER', 'cortex://default', 'Namespace used when a request omits owner. One derivation path, everywhere.'],
]

const ENDPOINTS: { method: string; path: string; what: string; body: string }[] = [
  {
    method: 'POST',
    path: '/v1/ingest',
    what: 'Extract durable facts from text and write them to your graph. wait:true returns the report inline, otherwise poll the job.',
    body: `{ "owner": "cortex://me", "prompt": "USER: we use pnpm in CI", "source": "mcp", "wait": true, "impact": 7 }`,
  },
  {
    method: 'POST',
    path: '/v1/recall',
    what: 'The briefing a model would receive: relevance × recency × impact, packed to the token budget, with truncated and memories_found reported.',
    body: `{ "owner": "cortex://me", "prompt": "package manager?", "token_budget": 400, "include_mesh": false, "explain": true }`,
  },
  {
    method: 'POST',
    path: '/v1/session/message',
    what: 'Buffer one turn of an ongoing conversation. The core only extracts on flush, so a 40-message chat costs one LLM pass.',
    body: `{ "owner": "cortex://me", "session_id": "tab-31", "role": "user", "content": "always run migrations before deploy", "source": "extension" }`,
  },
  {
    method: 'POST',
    path: '/v1/flush',
    what: 'End the session window and extract it. Returns { flushed_sessions, results: [IngestReport] } with counts, extractor and warnings.',
    body: `{ "session_id": "tab-31" }`,   // omit it to flush every buffered session
  },
  {
    method: 'GET',
    path: '/v1/memories?limit=50&q=deploy',
    what: 'List what is actually stored, with retention, lock state, provenance and the edges between them.',
    body: '',
  },
  {
    method: 'POST',
    path: '/v1/memories/:id/lock',
    what: 'Amygdala lock: exempt from decay forever. locked:false restores fading.',
    body: `{ "locked": true }`,
  },
  {
    method: 'DELETE',
    path: '/v1/memories/:id',
    what: 'The only deletion primitive: drops the node, its edges and its vector points. Nothing else in CORTEX ever deletes your memory.',
    body: '',
  },
  {
    method: 'POST',
    path: '/v1/sweep',
    what: 'Run the forgetting curve now instead of waiting for the interval. Reports evaluated / faded / depressed / pruned counts.',
    body: `{}`,
  },
  {
    method: 'GET',
    path: '/v1/resolve?uri=cortex://me',
    what: 'The cortex:// protocol view: a JSON-LD context packet for any namespace, budgeted like recall.',
    body: '',
  },
  {
    method: 'GET',
    path: '/v1/stats',
    what: 'Counts by category and provenance, avg retention, lock and fade totals, and the whole-graph token estimate.',
    body: '',
  },
  {
    method: 'GET',
    path: '/health',
    what: 'Which services are actually enabled. services.cloud_sync is false because CRDT sync is not implemented; extraction tells you whether an LLM key is set.',
    body: '',
  },
  {
    method: 'POST',
    path: '/v1/mesh/publish',
    what: 'Disabled by design. Returns 501 mesh_publish_disabled until the shared mesh has moderation and opt-in.',
    body: `{ "nodes": [], "edges": [] }`,
  },
]

type Tab = 'core' | 'mcp' | 'clients' | 'api'

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('core')
  const [flags, setFlags] = useState<string | null>(null)

  useEffect(() => {
    void core.health().then((result) => {
      if (!result.ok) {
        setFlags('no core reachable — the commands below still work, this line only reflects your own install')
        return
      }
      const health = result.data
      setFlags(
        `your core: backend ${health.backend} · extraction ${health.services.extraction ? 'LLM' : 'heuristics'} · decay ${health.decay_policy} · ${
          health.counts.nodes
        } nodes · cloud_sync ${health.services.cloud_sync ? 'on' : 'off (not implemented)'}`
      )
    })
  }, [])

  const tab = (id: Tab, label: string, icon: React.ReactNode) => (
    <button className={`button small ${activeTab === id ? '' : 'ghost'}`} onClick={() => setActiveTab(id)}>
      {icon} {label}
    </button>
  )

  return (
    <div className="wrap" style={{ paddingTop: 60, paddingBottom: 60 }}>
      <header style={{ marginBottom: 40 }}>
        <p className="eyebrow" style={{ color: 'var(--accent)' }}>
          DEVELOPER DOCS / 02
        </p>
        <h1 style={{ fontSize: 'clamp(42px,5vw,70px)', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.06em', lineHeight: 0.98 }}>
          Integration is <em>honest.</em>
        </h1>
        <p className="lead" style={{ maxWidth: 680, margin: '20px 0 20px' }}>
          Every command and body on this page is what the current build accepts — including the parts that are optional
          (Surreal, Qdrant) and the parts that are deliberately refused (mesh publishing, CRDT sync).
        </p>
        {flags ? <p className="mono" style={{ color: 'var(--secondary)', margin: 0 }}>{flags}</p> : null}

        <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 20, marginTop: 24, flexWrap: 'wrap' }}>
          {tab('core', 'Core & env', <Database size={14} />)}
          {tab('mcp', 'MCP & extension', <Puzzle size={14} />)}
          {tab('clients', 'SDKs & hydration', <Globe2 size={14} />)}
          {tab('api', 'REST API', <Code2 size={14} />)}
        </div>
      </header>

      {activeTab === 'core' ? (
        <div style={{ display: 'grid', gap: 40 }}>
          <section>
            <p className="eyebrow">RUN THE CORE</p>
            <h3 style={{ fontSize: 24, margin: '10px 0 0' }}>One binary, no services required</h3>
            <p style={{ color: 'var(--secondary)', maxWidth: 70 }}>
              The default backend is a JSON file you can read and back up.
            </p>
            <CopyBlock
              code={`git clone https://github.com/Aryan-Protein-Vala/CORTEX.git && cd CORTEX/cortex-core
cargo run --release --bin cortex-core
# → http://127.0.0.1:3030/health   ·   data in ~/.cortex/cortex-graph.json
# remote machine? export CORTEX_API_KEY=... first; it refuses to bind 0.0.0.0 without one.`}
            />
            <CopyBlock lang="text" code={`curl -s http://127.0.0.1:3030/health | python3 -m json.tool
# services.extraction false  → no OPENROUTER_API_KEY, so heuristics do the extraction
# services.cloud_sync  false → CRDT sync is not implemented (by design, reported honestly)`} />
          </section>

          <section>
            <p className="eyebrow">ENVIRONMENT</p>
            <div style={{ marginTop: 16, border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--muted)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px', font: '10px monospace', letterSpacing: '.08em' }}>VARIABLE</th>
                    <th style={{ padding: '10px 14px', font: '10px monospace', letterSpacing: '.08em' }}>DEFAULT</th>
                    <th style={{ padding: '10px 14px', font: '10px monospace', letterSpacing: '.08em' }}>MEANING</th>
                  </tr>
                </thead>
                <tbody>
                  {ENV_ROWS.map(([name, value, meaning]) => (
                    <tr key={name} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{name}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)' }}>{value}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--secondary)' }}>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'mcp' ? (
        <div className="timeline">
          <div className="step">
            <div className="step-marker">01</div>
            <div>
              <p className="mono">MODEL CONTEXT PROTOCOL</p>
              <h3>Build the server from this repo</h3>
              <p>
                The npm name <code>cortex-mcp</code> belongs to an unrelated package, so do not run{' '}
                <code>npx -y cortex-mcp</code>. Install the real one, then verify it with the bundled stdio smoke test.
              </p>
              <CopyBlock code={`cd cortex-mcp && npm install && npm test
# 21/21 checks passed  → the server speaks MCP against your core`} />
            </div>
            <div className="step-art" />
          </div>

          <div className="step">
            <div className="step-marker">02</div>
            <div>
              <p className="mono">IDE CONFIG</p>
              <h3>Point Cursor or Claude Desktop at it</h3>
              <p>
                Absolute path, because the IDE spawns this file — it is not a URL. <code>setup-cursor-mcp.sh</code> in
                the repo root merges this entry into <code>.cursor/mcp.json</code> and backs up any config it touches.
              </p>
              <CopyBlock
                lang="json"
                code={`{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/absolute/path/to/CORTEX/cortex-mcp/index.js"],
      "env": {
        "CORTEX_API_URL": "http://127.0.0.1:3030",
        "CORTEX_API_KEY": "",
        "CORTEX_OWNER": "cortex://me",
        "CORTEX_TOKEN_BUDGET": "400"
      }
    }
  }
}`}
              />
            </div>
            <div className="step-art" />
          </div>

          <div className="step">
            <div className="step-marker">03</div>
            <div>
              <p className="mono">BROWSER</p>
              <h3>Load the extension unpacked</h3>
              <p>
                Not on the Chrome Web Store yet — there is no install link to give you, only these steps. It reads
                nothing until you accept the consent card in a chat tab, and it only ever talks to your own core.
              </p>
              <CopyBlock code={`chrome://extensions → Developer mode → Load unpacked → select cortex-extension/
# then: cd cortex-core && cargo run --release --bin cortex-core`} />
              <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
                The popup is the control panel: pause, flush now, what was stored, and forget per memory.
              </p>
            </div>
            <div className="step-art" />
          </div>
        </div>
      ) : null}

      {activeTab === 'clients' ? (
        <div style={{ display: 'grid', gap: 36 }}>
          <section>
            <p className="eyebrow">TYPESCRIPT / JAVASCRIPT</p>
            <h3 style={{ fontSize: 24, margin: '10px 0 0' }}>cortex-js, from source</h3>
            <p style={{ color: 'var(--secondary)', maxWidth: 74 }}>Zero dependencies. Build it once, then install by path.</p>
            <CopyBlock
              code={`cd cortex-js && npm install && npm run build
cd ../your-app && npm install file:../cortex-js`}
            />
            <CopyBlock
              lang="ts"
              code={`import { Cortex, CortexError } from 'cortex-js'

const cortex = new Cortex({ url: 'http://127.0.0.1:3030', owner: 'cortex://me' })
const { result } = await cortex.remember('we ship from main behind a flag', { wait: true })
console.log(result?.triplets_extracted, result?.extractor)
const { briefing } = await cortex.recall('what is our release rule?', { tokenBudget: 400 })`}
            />
          </section>

          <section>
            <p className="eyebrow">PYTHON</p>
            <h3 style={{ fontSize: 24, margin: '10px 0 0' }}>cortex-py, standard library only</h3>
            <p style={{ color: 'var(--secondary)', maxWidth: 74 }}>
              Not published as <code>cortex-sdk</code> — that PyPI name is someone else&apos;s package.
            </p>
            <CopyBlock code={`pip install -e ./cortex-py`} />
            <CopyBlock
              lang="py"
              code={`import os
from cortex_py import Cortex

cortex = Cortex(base_url="http://127.0.0.1:3030", api_key=os.environ.get("CORTEX_API_KEY"), owner="cortex://me")
report = cortex.remember_report("always run migrations before deploy")
print(bool(report.stored), report.warnings)
print(cortex.recall("deploy checklist", token_budget=400).briefing)`}
            />
          </section>

          <section>
            <p className="eyebrow">HYDRATE YOUR HISTORY</p>
            <h3 style={{ fontSize: 24, margin: '10px 0 0' }}>Import a ChatGPT export</h3>
            <p style={{ color: 'var(--secondary)', maxWidth: 78 }}>
              It follows the conversation tree&apos;s <code>parent</code> chain (not every branch), marks speaker roles so
              assistant prose never becomes a &ldquo;fact about you&rdquo;, and needs an explicit <code>confirm</code>.
            </p>
            <CopyBlock
              lang="bash"
              code={`curl -X POST http://localhost:3000/api/hydrate \\
  -H "Content-Type: application/json" \\
  -d "{\"conversations\": $(jq -c . conversations.json), \"confirm\": true, \"owner\": \"cortex://me\"}"`}
            />
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              The response reports <code>queued</code>, <code>skipped</code> with reasons, <code>failed</code> and the
              rate-limit retries — nothing is silently dropped.
            </p>
          </section>
        </div>
      ) : null}

      {activeTab === 'api' ? (
        <div style={{ display: 'grid', gap: 34 }}>
          {ENDPOINTS.map((endpoint) => (
            <div key={`${endpoint.method}${endpoint.path}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,320px) minmax(0,1fr)', gap: 40, paddingBottom: 34, borderBottom: '1px solid var(--border)', alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      background: endpoint.method === 'DELETE' ? 'color-mix(in srgb, #dc2626 15%, transparent)' : 'color-mix(in srgb, var(--accent) 15%, transparent)',
                      color: endpoint.method === 'DELETE' ? '#dc2626' : 'var(--accent)',
                      border: `1px solid color-mix(in srgb, ${endpoint.method === 'DELETE' ? '#dc2626' : 'var(--accent)'} 30%, transparent)`,
                      padding: '4px 8px',
                      font: 'bold 11px monospace',
                    }}
                  >
                    {endpoint.method}
                  </span>
                  <span className="mono" style={{ color: 'var(--foreground)', fontSize: 14 }}>
                    {endpoint.path}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--secondary)', lineHeight: 1.6 }}>{endpoint.what}</p>
              </div>
              {endpoint.body ? <CopyBlock lang="json" code={endpoint.body} /> : <CopyBlock lang="bash" code={`curl -X ${endpoint.method} http://127.0.0.1:3030${endpoint.path.split('?')[0]} -H "x-cortex-key: $CORTEX_API_KEY"`} />}
            </div>
          ))}
          <p className="mono" style={{ color: 'var(--secondary)' }}>
            <Terminal size={12} /> errors are real HTTP statuses (400 / 401 / 403 / 404 / 429 / 501 / 503) with{' '}
            {`{"error":{"code","message","hint"}}`} — never a 200 with an error body.
          </p>
        </div>
      ) : null}
    </div>
  )
}
