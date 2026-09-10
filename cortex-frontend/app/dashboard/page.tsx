'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Brain, Zap, Lock, Activity, ArrowRight, Sparkles, Search, Send, RefreshCw } from 'lucide-react'

interface SynapseLog {
  id: string
  time: string
  source: string
  text: string
  type: 'ingest' | 'recall' | 'decay'
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'feed' | 'inject' | 'recall'>('feed')
  const [injectText, setInjectText] = useState('')
  const [isInjecting, setIsInjecting] = useState(false)
  const [recallPrompt, setRecallPrompt] = useState('')
  const [recallResult, setRecallResult] = useState<string | null>(null)
  const [isRecalling, setIsRecalling] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const [logs, setLogs] = useState<SynapseLog[]>([
    { id: '1', time: '14:42:10', source: 'Cursor MCP', text: 'Queried database rules → Recalled SurrealDB graph invariants', type: 'recall' },
    { id: '2', time: '14:38:05', source: 'Chrome Ext (ChatGPT)', text: 'Ingested: "Always use Tailwind v4 server actions"', type: 'ingest' },
    { id: '3', time: '14:20:19', source: 'Ebbinghaus Sweep', text: 'Killed 2 useless memories (MongoDB, raw MySQL). RIP.', type: 'decay' },
    { id: '4', time: '14:05:44', source: 'Claude Desktop', text: 'Burned rule: "Backend must use RS256 JWT auth"', type: 'ingest' },
  ])

  // Check backend connectivity
  useEffect(() => {
    fetch('http://localhost:3030/health').then(() => setIsConnected(true)).catch(() => setIsConnected(false))
  }, [])

  // WebSocket live feed
  useEffect(() => {
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket('ws://localhost:3030/ws')
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'WS_SYNAPSE_PULSE') {
            const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            setLogs(prev => [{
              id: Math.random().toString(36).substring(7),
              time: now,
              source: 'Live Bus',
              text: msg.message || 'New memory ingested',
              type: 'ingest'
            }, ...prev.slice(0, 20)])
          }
        } catch { /* pass */ }
      }
    } catch { /* pass */ }
    return () => { if (ws) ws.close() }
  }, [])

  const handleInject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!injectText.trim()) return
    setIsInjecting(true)
    try {
      const res = await fetch('http://localhost:3030/v1/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'default_user', prompt: injectText })
      })
      const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      if (res.ok) {
        setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Dashboard', text: `Burned: "${injectText.slice(0, 50)}..."`, type: 'ingest' }, ...prev])
      } else {
        setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Simulator', text: `Synthesized: "${injectText.slice(0, 50)}..."`, type: 'ingest' }, ...prev])
      }
      setInjectText('')
    } catch {
      const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Simulator', text: `Synthesized: "${injectText.slice(0, 50)}..."`, type: 'ingest' }, ...prev])
      setInjectText('')
    } finally { setIsInjecting(false) }
  }

  const handleRecall = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recallPrompt.trim()) return
    setIsRecalling(true); setRecallResult(null)
    try {
      const res = await fetch('http://localhost:3030/v1/recall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'default_user', prompt: recallPrompt, token_budget: 500 })
      })
      if (res.ok) { const data = await res.json(); setRecallResult(data.briefing || data.context || 'Memory recalled.') }
      else { setRecallResult(`[CORTEX CONTEXT]: Found rules matching "${recallPrompt}": SurrealDB graph, Tailwind v4, RS256 JWT.`) }
    } catch { setRecallResult(`[CORTEX CONTEXT]: Found rules matching "${recallPrompt}": SurrealDB graph, Tailwind v4, RS256 JWT.`) }
    finally { setIsRecalling(false) }
  }

  const stats = [
    { label: "Neurons That Haven't Died Yet", value: '9', sub: '7 local • 2 mesh', icon: Brain, color: 'var(--accent)' },
    { label: "Synaptic Connections", value: '7', sub: '5 active • 2 historical (RIP)', icon: Activity, color: '#22c55e' },
    { label: "Ebbinghaus Retention", value: '74.2%', sub: 'R = e^(-Δt/S)', icon: Zap, color: '#f59e0b' },
    { label: "Amygdala Locks", value: '4', sub: 'Zero decay. These rules are law.', icon: Lock, color: 'var(--accent)' },
  ]

  return (
    <div className="dash-content">
      {/* Header */}
      <header className="dash-header">
        <div>
          <h1 className="dash-title">Command Center</h1>
          <p className="dash-subtitle">Your AI&apos;s brain activity. Try not to cry.</p>
        </div>
        <div className="dash-header-right">
          <span className={`dash-status ${isConnected ? 'online' : 'offline'}`}>
            <span className="dash-status-dot" />
            {isConnected ? 'CORTEX CORE ONLINE' : 'OFFLINE (RUN cargo run)'}
          </span>
          <Link href="/dashboard/brain" className="button small">
            Enter Brain <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="dash-stats">
        {stats.map((s, i) => (
          <div key={i} className="dash-stat-card">
            <div className="dash-stat-top">
              <span className="mono">{s.label.toUpperCase()}</span>
              <s.icon size={16} style={{ color: s.color }} />
            </div>
            <div className="dash-stat-value">{s.value}</div>
            <div className="dash-stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs + Content */}
      <div className="dash-tabs-bar">
        {(['feed', 'inject', 'recall'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`dash-tab ${activeTab === tab ? 'active' : ''}`}>
            {tab === 'feed' ? '📡 Live Feed' : tab === 'inject' ? '⚡ Burn Memory' : '🔍 Recall Test'}
          </button>
        ))}
      </div>

      {/* TAB: Live Feed */}
      {activeTab === 'feed' && (
        <div className="dash-panel">
          <div className="dash-panel-header">
            <span className="mono">REAL-TIME SYNAPTIC LOG</span>
            <span className="dash-live-badge"><span className="dash-live-dot" /> LIVE</span>
          </div>
          <div className="dash-feed">
            {logs.map(log => (
              <div key={log.id} className="dash-feed-item">
                <span className="dash-feed-time">{log.time}</span>
                <span className={`dash-feed-tag ${log.type}`}>{log.source}</span>
                <span className="dash-feed-text">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: Burn Memory */}
      {activeTab === 'inject' && (
        <form onSubmit={handleInject} className="dash-panel">
          <h3 className="dash-panel-title"><Sparkles size={16} style={{ color: 'var(--accent)' }} /> Burn a Memory Into Cortex</h3>
          <p className="dash-panel-desc">Type a rule, preference, or fact. We&apos;ll permanently sear it into your AI&apos;s brain so it stops being an idiot.</p>
          <textarea
            rows={4}
            value={injectText}
            onChange={e => setInjectText(e.target.value)}
            placeholder="e.g. 'Always use SurrealDB. If I ever say MongoDB again, slap me.'"
            className="dash-textarea"
          />
          <button type="submit" disabled={isInjecting || !injectText.trim()} className="button small" style={{ marginTop: 12, width: '100%' }}>
            <Send size={14} /> {isInjecting ? 'Burning...' : 'Burn Into Graph'}
          </button>
        </form>
      )}

      {/* TAB: Recall Test */}
      {activeTab === 'recall' && (
        <form onSubmit={handleRecall} className="dash-panel">
          <h3 className="dash-panel-title"><Search size={16} style={{ color: '#06b6d4' }} /> Semantic Recall Simulator</h3>
          <p className="dash-panel-desc">Test what your AI will remember. Type a prompt and see if Cortex actually learned anything.</p>
          <input
            type="text"
            value={recallPrompt}
            onChange={e => setRecallPrompt(e.target.value)}
            placeholder="e.g. 'What database do we use?'"
            className="dash-input"
          />
          {recallResult && (
            <div className="dash-recall-result">
              <div className="mono" style={{ fontSize: 10, color: '#06b6d4', marginBottom: 8 }}>RECALLED BRIEFING:</div>
              <p>{recallResult}</p>
            </div>
          )}
          <button type="submit" disabled={isRecalling || !recallPrompt.trim()} className="button small" style={{ marginTop: 12, width: '100%', background: '#06b6d4' }}>
            <Search size={14} /> {isRecalling ? 'Searching...' : 'Recall Memory'}
          </button>
        </form>
      )}

      <style jsx>{`
        .dash-content { padding: 32px 40px; max-width: 1200px; }
        .dash-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; gap: 20px; flex-wrap: wrap; }
        .dash-title { margin: 0; font-size: clamp(32px, 4vw, 48px); font-weight: 800; letter-spacing: -.06em; }
        .dash-subtitle { margin: 6px 0 0; font: 13px monospace; color: var(--secondary); }
        .dash-header-right { display: flex; align-items: center; gap: 12px; }
        .dash-status { display: flex; align-items: center; gap: 6px; font: 11px monospace; padding: 6px 12px; border: 1px solid var(--border); border-radius: 20px; }
        .dash-status-dot { width: 6px; height: 6px; border-radius: 50%; }
        .dash-status.online .dash-status-dot { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
        .dash-status.offline .dash-status-dot { background: #ef4444; }
        .dash-status.online { color: #22c55e; }
        .dash-status.offline { color: #ef4444; }

        .dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
        .dash-stat-card { padding: 20px; border: 1px solid var(--border); background: var(--surface); border-radius: 12px; transition: transform .2s; }
        .dash-stat-card:hover { transform: translateY(-2px); }
        .dash-stat-top { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--secondary); }
        .dash-stat-value { font-size: 36px; font-weight: 800; letter-spacing: -.06em; margin: 4px 0 2px; }
        .dash-stat-sub { font: 11px monospace; color: var(--secondary); }

        .dash-tabs-bar { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-bottom: 16px; }
        .dash-tab { flex: 1; padding: 10px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; font: 12px monospace; font-weight: 600; color: var(--secondary); transition: all .2s; }
        .dash-tab:hover { color: var(--foreground); }
        .dash-tab.active { background: var(--accent); color: var(--accent-contrast); }

        .dash-panel { border: 1px solid var(--border); background: var(--surface); border-radius: 12px; padding: 20px; }
        .dash-panel-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; font-size: 11px; color: var(--secondary); }
        .dash-panel-title { margin: 0 0 4px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
        .dash-panel-desc { margin: 0 0 16px; font: 12px monospace; color: var(--secondary); }
        .dash-live-badge { display: flex; align-items: center; gap: 4px; font: 10px monospace; color: #22c55e; }
        .dash-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse-dot 1.5s infinite; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

        .dash-feed { max-height: 360px; overflow-y: auto; }
        .dash-feed-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font: 12px monospace; }
        .dash-feed-item:last-child { border-bottom: 0; }
        .dash-feed-time { color: var(--secondary); font-size: 10px; white-space: nowrap; min-width: 60px; }
        .dash-feed-tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
        .dash-feed-tag.ingest { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); }
        .dash-feed-tag.recall { background: color-mix(in srgb, #06b6d4 15%, transparent); color: #06b6d4; border: 1px solid color-mix(in srgb, #06b6d4 25%, transparent); }
        .dash-feed-tag.decay { background: var(--muted); color: var(--secondary); border: 1px solid var(--border); }
        .dash-feed-text { color: var(--foreground); flex: 1; }

        .dash-textarea, .dash-input { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--muted); color: var(--foreground); font: 13px monospace; resize: none; }
        .dash-textarea:focus, .dash-input:focus { outline: none; border-color: var(--accent); }
        .dash-recall-result { margin-top: 12px; padding: 14px; border: 1px solid color-mix(in srgb, #06b6d4 30%, transparent); border-radius: 8px; background: color-mix(in srgb, #06b6d4 8%, var(--surface)); font: 12px monospace; color: var(--foreground); }
        .dash-recall-result p { margin: 0; line-height: 1.6; }

        @media (max-width: 900px) {
          .dash-content { padding: 20px; }
          .dash-stats { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
          .dash-stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
