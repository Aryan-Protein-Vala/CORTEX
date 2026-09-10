'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, Flame, ArrowRight, Search, RotateCw } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { core, describeFailure, type IngestReport, type RecallResult, type SweepReport } from '@/lib/core'
import { timeAgo, useCore, useCoreSocket, type PanelState } from '@/lib/use-core'

/* Decorative schematic of a memory graph. It is labelled as a schematic and is
   aria-hidden: the numbers below it are the real measurements. */
function Graph({ active, total, mesh }: { active: number; total: number; mesh: boolean }) {
  const points = [
    [32, 90],
    [100, 45],
    [168, 112],
    [240, 46],
    [305, 98],
    [370, 38],
    [430, 104],
    [492, 55],
  ]
  const edges = [
    [0, 1],
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 5],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 7],
  ]
  const meshPoints = [
    [60, 20],
    [140, 10],
    [220, 140],
    [280, 20],
    [350, 130],
    [420, 15],
    [480, 120],
  ]
  const meshEdges = [
    [0, 1],
    [2, 4],
    [3, 5],
    [4, 6],
    [1, 3],
    [0, 2],
  ]
  const lit = total === 0 ? 0 : Math.max(1, Math.min(8, Math.round((active / Math.max(1, total)) * 8)))

  return (
    <svg
      className="graph"
      viewBox="0 0 525 150"
      aria-hidden="true"
      style={{ width: '100%', maxWidth: 525 }}
    >
      <AnimatePresence>
        {mesh && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}>
            {meshEdges.map(([a, b], i) => (
              <path
                key={`mesh-e-${i}`}
                d={`M${meshPoints[a][0]} ${meshPoints[a][1]} L ${meshPoints[b][0]} ${meshPoints[b][1]}`}
                className="graph-path global-mesh"
              />
            ))}
            {meshPoints.map(([x, y], i) => (
              <circle key={`mesh-n-${i}`} cx={x} cy={y} r={3} className="graph-node global-mesh" />
            ))}
          </motion.g>
        )}
      </AnimatePresence>
      {edges.map(([a, b], i) => (
        <path
          key={`e-${i}`}
          d={`M${points[a][0]} ${points[a][1]} Q ${(points[a][0] + points[b][0]) / 2} ${
            (points[a][1] + points[b][1]) / 2 - 25
          } ${points[b][0]} ${points[b][1]}`}
          className={i < lit ? 'graph-path active' : 'graph-path'}
          style={{ animationDelay: `${i * 110}ms` }}
        />
      ))}
      {points.map(([x, y], i) => (
        <circle
          key={`n-${i}`}
          cx={x}
          cy={y}
          r={i < lit ? 5 : 3}
          className={i < lit ? 'graph-node active' : 'graph-node'}
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </svg>
  )
}

type FeedEntry = {
  id: string
  when: string
  source: string
  text: string
  kind: 'ingest' | 'recall' | 'decay'
}

function StatusPill({ state, message }: { state: PanelState; message: string }) {
  const tone = state === 'ready' || state === 'empty' ? 'ok' : state === 'offline' || state === 'denied' || state === 'error' ? 'down' : 'wait'
  const label =
    state === 'loading'
      ? 'CHECKING CORE…'
      : state === 'offline'
        ? 'CORE NOT REACHABLE'
        : state === 'denied'
          ? 'CORE REJECTED THE KEY'
          : state === 'error'
            ? 'CORE ERROR'
            : state === 'empty'
              ? 'CORE ONLINE · NO MEMORIES YET'
              : 'CORE ONLINE'
  return (
    <span className={`core-pill ${tone}`} title={message || undefined}>
      <i /> {label}
    </span>
  )
}

function Kpi({ n, title, value, note, pending }: { n: string; title: string; value: string; note: string; pending?: boolean }) {
  return (
    <article className="pain-card" style={{ minHeight: 'auto', padding: 24 }}>
      <span className="card-num">{n}</span>
      <div style={{ marginTop: 26 }}>
        <p className="mono" style={{ margin: '0 0 6px' }}>
          {title.toUpperCase()}
        </p>
        <strong className={`kpi-value${pending ? ' pending' : ''}`}>{value}</strong>
        <p className="kpi-note">{note}</p>
      </div>
    </article>
  )
}

function SkeletonBlock({ height = 12, width = '100%' }: { height?: number; width?: string }) {
  return <span className="skeleton" style={{ height, width }} />
}

export default function DashboardPage() {
  const { state, health, stats, memories, message, liveUpdates, lastUpdated, refresh, isRefreshing } = useCore()
  const [injectText, setInjectText] = useState('')
  const [isInjecting, setIsInjecting] = useState(false)
  const [injectResult, setInjectResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [recallPrompt, setRecallPrompt] = useState('')
  const [recallResult, setRecallResult] = useState<{ ok: boolean; text: string; meta?: string } | null>(null)
  const [isRecalling, setIsRecalling] = useState(false)
  const [sweepResult, setSweepResult] = useState<string | null>(null)
  const [isSweeping, setIsSweeping] = useState(false)
  const [liveEvents, setLiveEvents] = useState<FeedEntry[]>([])

  const feed = useMemo<FeedEntry[]>(() => {
    const stored: FeedEntry[] = (memories?.memories ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 14)
      .map((node, index) => ({
        id: `${node.id}-${index}`,
        when: node.updated_at,
        source: node.provenance || 'unknown',
        text: `${node.label} · impact ${node.impact}${node.locked ? ' · locked' : ''}${node.fading ? ' · fading' : ''} · retention ${(node.retention * 100).toFixed(0)}%`,
        kind: node.fading ? 'decay' : 'ingest',
      }))
    return [...liveEvents, ...stored]
  }, [memories, liveEvents])

  useCoreSocket(
    (event) => {
      const label =
        event.type === 'WS_SYNAPSE_PULSE'
          ? 'a memory was written'
          : event.type === 'WS_DECAY'
            ? 'the decay sweep changed retention'
            : event.type === 'sweep'
              ? 'decay sweep finished'
              : event.type
      setLiveEvents((prev) =>
        [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, when: event.at ?? new Date().toISOString(), source: 'live bus', text: label, kind: 'ingest' as const }, ...prev].slice(0, 12)
      )
      void refresh()
    },
    liveUpdates
  )

  const canWrite = state === 'ready' || state === 'empty'

  const handleInject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!injectText.trim() || !canWrite) return
    setIsInjecting(true)
    setInjectResult(null)
    const result = await core.ingest({ prompt: `USER: ${injectText.trim()}`, source: 'dashboard', wait: true })
    setIsInjecting(false)
    if (!result.ok) {
      setInjectResult({ ok: false, text: describeFailure(result) })
      return
    }
    const report: IngestReport | undefined = result.data.result
    if (!report) {
      setInjectResult({ ok: true, text: `Queued as ${result.data.job_id}. Extraction is still running — refresh in a moment.` })
    } else if (report.triplets_extracted === 0) {
      setInjectResult({
        ok: false,
        text: `Nothing durable was found in that text, so nothing was stored. State one fact at a time, e.g. "always use pnpm in CI". ${report.warnings?.length ? `(${report.warnings[0]})` : ''}`,
      })
    } else {
      setInjectResult({
        ok: true,
        text: `Stored ${report.triplets_extracted} triplet(s), ${report.nodes_new} new node(s), ${report.edges_new} new edge(s) via ${report.extractor}.${report.warnings?.length ? ` Warning: ${report.warnings.join(' ')}` : ''}`,
      })
      setInjectText('')
    }
    void refresh()
  }

  const handleRecall = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!recallPrompt.trim() || !canWrite) return
    setIsRecalling(true)
    setRecallResult(null)
    const result = await core.recall({ prompt: recallPrompt.trim(), explain: true })
    setIsRecalling(false)
    if (!result.ok) {
      setRecallResult({ ok: false, text: describeFailure(result) })
      return
    }
    const data: RecallResult = result.data
    if (!data.briefing.trim()) {
      setRecallResult({
        ok: false,
        text: `No memories matched. Scanned ${data.scanned} node(s) in ${data.owner_uri}; the budget was ${data.token_budget} tokens. This is an honest empty result, not a failure.`,
      })
      return
    }
    setRecallResult({
      ok: true,
      text: data.briefing,
      meta: `${data.memories_found} memories · ${data.tokens_used}/${data.token_budget} tokens${data.truncated ? ' · truncated to fit' : ''}${
        data.debug?.length ? ` · top score ${data.debug[0]?.score?.toFixed(2)}` : ''
      }`,
    })
  }

  const handleSweep = async () => {
    if (!canWrite) return
    setIsSweeping(true)
    setSweepResult(null)
    const result = await core.sweep()
    setIsSweeping(false)
    if (!result.ok) {
      setSweepResult(describeFailure(result))
      return
    }
    const report: SweepReport = result.data
    setSweepResult(
      `policy ${report.policy}: evaluated ${report.evaluated_nodes} nodes / ${report.evaluated_edges} edges · faded ${report.faded_nodes} · depressed ${report.depressed_edges} · deleted ${report.pruned_nodes} · protected ${report.protected_nodes}`
    )
    void refresh()
  }

  const offline = (
    <div className="state-card">
      <h3>{state === 'denied' ? 'The core is asking for a key' : 'No core is connected'}</h3>
      <p>{message || 'The dashboard reads a local CORTEX core through /api/core. Nothing here is simulated — when the core is missing you see this instead of numbers.'}</p>
      {state === 'denied' ? (
        <p>
          Set <code>CORTEX_API_KEY</code> in this site&apos;s environment to the same value the core was started with, then reload.
        </p>
      ) : (
        <div className="row">
          <code>cd cortex-core &amp;&amp; cargo run --release --bin cortex-core</code>
        </div>
      )}
      <div className="row">
        <button type="button" className="button small" onClick={() => void refresh()} disabled={isRefreshing}>
          <RotateCw size={14} /> {isRefreshing ? 'Retrying…' : 'Retry now'}
        </button>
        <Link href="/dashboard/docs" className="button small ghost">
          Setup docs
        </Link>
      </div>
    </div>
  )

  return (
    <div className="wrap" style={{ paddingTop: 60, paddingBottom: 60 }}>
      <header style={{ marginBottom: 44 }}>
        <p className="eyebrow" style={{ color: 'var(--accent)' }}>
          COMMAND CENTER / 01
        </p>
        <h1 style={{ fontSize: 'clamp(42px,5vw,70px)', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.06em', lineHeight: 0.98 }}>
          Watch the brain <em>work.</em>
        </h1>
        <p className="lead" style={{ maxWidth: 600, margin: '20px 0 30px' }}>
          Every number below is read from your core — the same graph your MCP and extension write to. No sample data, no
          screenshots of a hypothetical.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
          <StatusPill state={state} message={message} />
          {lastUpdated ? (
            <span className="mono" style={{ color: 'var(--secondary)' }}>
              {liveUpdates ? 'live socket + ' : 'polling every 20s · '}updated {timeAgo(lastUpdated)}
            </span>
          ) : null}
          <Link href="/dashboard/brain" className="button small">
            Enter 3D Mind <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {state === 'offline' || state === 'denied' || state === 'error' ? (
        <div style={{ marginBottom: 40 }}>{offline}</div>
      ) : null}

      {state === 'empty' ? (
        <div className="state-card" style={{ marginBottom: 40 }}>
          <h3>Connected, and empty — which is correct for a new install</h3>
          <p>
            Your core is running and writable, with no memories yet. Store one below and it will appear here, in the 3D
            view, and in every MCP client immediately.
          </p>
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Backend <code>{health?.backend ?? '—'}</code> · decay policy <code>{health?.decay_policy ?? '—'}</code> ·
            extraction <code>{health?.services?.extraction ? 'LLM (OpenRouter)' : 'offline heuristics'}</code>
          </p>
        </div>
      ) : null}

      <div className="pain-grid" style={{ marginTop: 0, marginBottom: 60, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          n="01"
          title="Memories"
          value={stats ? String(stats.nodes) : '—'}
          pending={!stats}
          note={stats ? `${health?.counts.nodes ?? stats.nodes} nodes · ${health?.counts.buffered_sessions ?? 0} session(s) buffering` : 'no core'}
        />
        <Kpi
          n="02"
          title="Relations"
          value={stats ? String(stats.edges) : '—'}
          pending={!stats}
          note={stats ? `${stats.historical} historical after corrections` : 'no core'}
        />
        <Kpi
          n="03"
          title="Avg retention"
          value={stats ? `${(stats.avg_retention * 100).toFixed(1)}%` : '—'}
          pending={!stats}
          note={stats ? `R = e^(-Δt/S) · ${stats.fading} fading under policy ${stats.decay_policy}` : 'no core'}
        />
        <Kpi
          n="04"
          title="Amygdala locks"
          value={stats ? String(stats.locked) : '—'}
          pending={!stats}
          note={stats ? 'exempt from decay by construction' : 'no core'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 30 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 30, marginBottom: 30 }}>
            <div className="box-top" style={{ marginBottom: 24 }}>
              <span>MEMORY GRAPH</span>
              <span style={{ color: 'var(--accent)' }}>●</span>
            </div>
            {state === 'loading' ? (
              <div style={{ display: 'grid', gap: 12, padding: '40px 0' }}>
                <SkeletonBlock height={90} />
                <SkeletonBlock height={12} width="60%" />
              </div>
            ) : (
              <Graph active={stats?.nodes ?? 0} total={stats?.nodes ?? 0} mesh={Boolean(health?.services?.graph && (stats?.nodes ?? 0) > 4)} />
            )}
            <div className="visual-caption" style={{ marginTop: 24 }}>
              <span>whole graph costs</span>
              <strong>{stats ? `${stats.full_graph_token_estimate} tk` : '—'}</strong>
              <small>
                {stats
                  ? `why budgeting matters: recall packs a ${stats.nodes}-node graph into one bounded block`
                  : 'no core'}
              </small>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div className="box-top" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <span>RECENTLY REMEMBERED</span>
              <span className="mono" style={{ color: 'var(--secondary)' }}>
                {liveUpdates ? 'LIVE' : 'POLLED'}
              </span>
            </div>
            <div style={{ padding: '10px 24px 24px', maxHeight: 420, overflowY: 'auto' }}>
              {state === 'loading' ? (
                <div style={{ display: 'grid', gap: 14, padding: '18px 0' }}>
                  {[0, 1, 2, 3].map((i) => (
                    <SkeletonBlock key={i} height={16} />
                  ))}
                </div>
              ) : feed.length === 0 ? (
                <p className="kpi-note" style={{ padding: '18px 0' }}>
                  Nothing stored yet. Use BURN MEMORY, the MCP <code>cortex_remember</code> tool, or the browser extension.
                </p>
              ) : (
                feed.map((entry) => (
                  <div key={entry.id} className="feed-row">
                    <span className="when">{timeAgo(entry.when)}</span>
                    <span className={`tag ${entry.kind}`}>{entry.source.toUpperCase().slice(0, 11)}</span>
                    <span className="body">{entry.text}</span>
                    <span className="when">{entry.kind === 'decay' ? 'fading' : 'stored'}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <form onSubmit={handleInject} style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 24 }}>
            <div className="box-top" style={{ marginBottom: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Flame size={14} /> BURN MEMORY
              </span>
              {!canWrite ? <span className="mono">disabled</span> : null}
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--secondary)' }}>
              One atomic fact or rule. The extractor — your LLM if configured, heuristics otherwise — decides what
              becomes a graph edge.
            </p>
            <textarea
              className="field"
              rows={4}
              value={injectText}
              onChange={(e) => setInjectText(e.target.value)}
              placeholder={"e.g. never hand-write SQL; every query goes through the typed query builder"}
              disabled={!canWrite}
            />
            <button type="submit" className="button small" disabled={!canWrite || isInjecting || !injectText.trim()} style={{ width: '100%', marginTop: 16 }}>
              {isInjecting ? 'Extracting…' : 'Remember this'}
            </button>
            {injectResult ? <div className={`result-box${injectResult.ok ? '' : ' err'}`}>{injectResult.text}</div> : null}
          </form>

          <form onSubmit={handleRecall} style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 24 }}>
            <div className="box-top" style={{ marginBottom: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={14} /> RECALL TEST
              </span>
              <Activity size={14} style={{ color: 'var(--secondary)' }} />
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--secondary)' }}>
              Ask the graph a question and see exactly what a model would be given, including why each memory matched.
            </p>
            <input
              className="field"
              type="text"
              value={recallPrompt}
              onChange={(e) => setRecallPrompt(e.target.value)}
              placeholder="which database do we use?"
              disabled={!canWrite}
            />
            <button type="submit" className="button small ghost" disabled={!canWrite || isRecalling || !recallPrompt.trim()} style={{ width: '100%', marginTop: 16 }}>
              {isRecalling ? 'Searching…' : 'Run recall'}
            </button>
            {recallResult ? (
              <div className={`result-box${recallResult.ok ? '' : ' err'}`}>
                {recallResult.meta ? <div style={{ opacity: 0.75, marginBottom: 8 }}>{recallResult.meta}</div> : null}
                {recallResult.text}
              </div>
            ) : null}
          </form>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 24 }}>
            <div className="box-top" style={{ marginBottom: 16 }}>
              <span>FORGETTING</span>
              <span className="mono">{stats?.decay_policy ?? '—'}</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--secondary)' }}>
              Sweep now: recomputes retention and fades what fell below threshold. Under the default <code>soft</code>{' '}
              policy nothing is deleted; deletion requires starting the core with <code>CORTEX_DECAY_POLICY=prune</code>.
            </p>
            <button type="button" className="button small ghost" onClick={() => void handleSweep()} disabled={!canWrite || isSweeping} style={{ width: '100%' }}>
              {isSweeping ? 'Sweeping…' : 'Run decay sweep'}
            </button>
            {sweepResult ? <div className="result-box">{sweepResult}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
