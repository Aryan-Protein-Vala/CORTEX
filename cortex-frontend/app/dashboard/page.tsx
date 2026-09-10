'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Activity, Flame, ArrowRight, CheckCircle2, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// The landing page Graph component (local to avoid mutating app/page.tsx)
function Graph({ active = 4, isLive = false, meshMode = false }: { active?: number; isLive?: boolean, meshMode?: boolean }) {
  const [activeNodes, setActiveNodes] = useState(active);
  
  useEffect(() => {
    if (!isLive || typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    try {
      const wsUrl = process.env.NEXT_PUBLIC_CORTEX_WS_URL || "ws://localhost:3030/ws";
      ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'WS_SYNAPSE_PULSE') {
            setActiveNodes(prev => Math.min(prev + 1, 8));
          } else if (data.type === 'WS_DECAY') {
            setActiveNodes(prev => Math.max(prev - 1, 0));
          }
        } catch { /* Ignored */ }
      };

      ws.onerror = () => { /* Silently handle offline */ };
    } catch { /* Ignored */ }
    
    return () => {
      if (ws) ws.close();
    };
  }, [isLive]);

  const points = [[32,90],[100,45],[168,112],[240,46],[305,98],[370,38],[430,104],[492,55]];
  const edges = [[0,1],[1,2],[1,3],[2,3],[2,4],[3,5],[4,5],[4,6],[5,7],[6,7]];
  
  const meshPoints = [[60, 20], [140, 10], [220, 140], [280, 20], [350, 130], [420, 15], [480, 120]];
  const meshEdges = [[0,1], [2,4], [3,5], [4,6], [1,3], [0,2]];

  return (
    <svg className="graph" viewBox="0 0 525 150" role="img" aria-label="Cortex memory graph visualization" style={{ width: '100%', maxWidth: '525px' }}>
      <AnimatePresence>
        {meshMode && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}>
            {meshEdges.map(([a,b], i) => <path key={`mesh-e-${i}`} d={`M${meshPoints[a][0]} ${meshPoints[a][1]} L ${meshPoints[b][0]} ${meshPoints[b][1]}`} className="graph-path global-mesh" />)}
            {meshPoints.map(([x,y], i) => <circle key={`mesh-n-${i}`} cx={x} cy={y} r={3} className="graph-node global-mesh" />)}
          </motion.g>
        )}
      </AnimatePresence>
      
      {edges.map(([a,b], i) => <path key={`e-${i}`} d={`M${points[a][0]} ${points[a][1]} Q ${(points[a][0]+points[b][0])/2} ${(points[a][1]+points[b][1])/2-25} ${points[b][0]} ${points[b][1]}`} className={i < activeNodes ? 'graph-path active' : 'graph-path'} style={{ animationDelay: `${i * 110}ms` }} />)}
      {points.map(([x,y], i) => <circle key={`n-${i}`} cx={x} cy={y} r={i < activeNodes ? 5 : 3} className={i < activeNodes ? 'graph-node active' : 'graph-node'} style={{ animationDelay: `${i * 140}ms` }} />)}
    </svg>
  )
}

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

  useEffect(() => {
    fetch('http://localhost:3030/health').then(() => setIsConnected(true)).catch(() => setIsConnected(false))
  }, [])

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

  const CORTEX_API = process.env.NEXT_PUBLIC_CORTEX_API_URL || 'http://127.0.0.1:3030'

  const handleInject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!injectText.trim()) return
    setIsInjecting(true)
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    try {
      const res = await fetch(`${CORTEX_API}/v1/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'default_user', prompt: injectText })
      })
      if (res.ok) {
        setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Dashboard', text: `Saved to memory: "${injectText.slice(0, 50)}..."`, type: 'ingest' }, ...prev])
        setInjectText('')
      } else {
        setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Error', text: `Failed to persist: HTTP ${res.status}`, type: 'decay' }, ...prev])
      }
    } catch {
      setLogs(prev => [{ id: Math.random().toString(36).substring(7), time: now, source: 'Error', text: `Cortex Core unreachable on ${CORTEX_API}`, type: 'decay' }, ...prev])
    } finally { setIsInjecting(false) }
  }

  const handleRecall = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recallPrompt.trim()) return
    setIsRecalling(true); setRecallResult(null)
    try {
      const res = await fetch(`${CORTEX_API}/v1/recall`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'default_user', prompt: recallPrompt, token_budget: 500 })
      })
      if (res.ok) {
        const data = await res.json()
        setRecallResult(data.briefing || data.context || 'No matching memories found for this prompt.')
      } else {
        setRecallResult(`[CORTEX ERROR]: Core returned HTTP ${res.status}.`)
      }
    } catch {
      setRecallResult(`[CORTEX OFFLINE]: Unable to connect to Cortex Core daemon on ${CORTEX_API}. Start it with 'cd cortex-core && cargo run'.`)
    } finally { setIsRecalling(false) }
  }

  return (
    <div className="dash-content wrap" style={{ paddingTop: '60px', paddingBottom: '60px' }}>
      {/* Header */}
      <header style={{ marginBottom: '60px' }}>
        <p className="eyebrow" style={{ color: 'var(--accent)' }}>COMMAND CENTER / 01</p>
        <h1 style={{ fontSize: 'clamp(42px,5vw,70px)', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.06em', lineHeight: .98 }}>
          Watch the brain <em>work.</em>
        </h1>
        <p className="lead" style={{ maxWidth: '600px', margin: '20px 0 30px' }}>
          This isn&apos;t a stupid dashboard. This is the live synaptic feed of your AI.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ 
            font: '11px monospace', color: isConnected ? '#22c55e' : '#ef4444', 
            display: 'flex', alignItems: 'center', gap: '8px',
            border: `1px solid ${isConnected ? '#22c55e30' : '#ef444430'}`, padding: '6px 12px', borderRadius: '4px'
          }}>
            <span style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', background: isConnected ? '#22c55e' : '#ef4444' }} />
            {isConnected ? 'CORTEX CORE ONLINE' : 'OFFLINE (RUN cargo run)'}
          </span>
          <Link href="/dashboard/brain" className="button small">
            Enter 3D Mind <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Stats Grid - using pain-grid styles */}
      <div className="pain-grid" style={{ marginTop: '0', marginBottom: '70px', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          ['01', 'Neurons', '9', '7 local • 2 mesh'],
          ['02', 'Synaptic Links', '7', '5 active • 2 historical'],
          ['03', 'Ebbinghaus', '74.2%', 'R = e^(-Δt/S)'],
          ['04', 'Amygdala Locks', '4', 'Zero decay. These are law.'],
        ].map(([n, t, v, d]) => (
          <article key={n} className="pain-card" style={{ minHeight: 'auto', padding: '24px' }}>
            <span className="card-num">{n}</span>
            <div style={{ marginTop: '30px' }}>
              <p className="mono" style={{ margin: '0 0 10px' }}>{t.toUpperCase()}</p>
              <strong style={{ display: 'block', fontSize: '48px', fontWeight: 400, color: 'var(--accent)', margin: '0 0 10px', lineHeight: 1 }}>{v}</strong>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--secondary)' }}>{d}</p>
            </div>
          </article>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '30px' }}>
        
        {/* Left Column: Visuals & Live Feed */}
        <div>
          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '30px', marginBottom: '30px' }}>
            <div className="box-top" style={{ marginBottom: '30px' }}>
              <span>LIVE HIVE MIND GRAPH</span>
              <span style={{ color: 'var(--accent)' }}>●</span>
            </div>
            <Graph active={6} isLive={true} />
            <div className="visual-caption" style={{ marginTop: '30px' }}>
              <span>status</span>
              <strong>ACTIVE</strong>
              <small>Processing memories...</small>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div className="box-top" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <span>REAL-TIME SYNAPTIC LOG</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'node-pulse 2s infinite' }} /> LIVE
              </span>
            </div>
            <div style={{ padding: '10px 24px 24px', maxHeight: '400px', overflowY: 'auto' }}>
              {logs.map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="mono" style={{ fontSize: '10px', color: 'var(--secondary)', minWidth: '60px' }}>{log.time}</span>
                  <span className="mono" style={{ 
                    fontSize: '10px', padding: '3px 8px', borderRadius: '4px',
                    color: log.type === 'ingest' ? 'var(--accent)' : log.type === 'recall' ? '#06b6d4' : 'var(--secondary)',
                    border: `1px solid ${log.type === 'ingest' ? 'var(--accent)' : log.type === 'recall' ? '#06b6d4' : 'var(--border)'}`,
                    opacity: 0.8
                  }}>{log.source.toUpperCase()}</span>
                  <span style={{ fontSize: '13px', color: 'var(--foreground)', flex: 1, fontFamily: 'monospace' }}>{log.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Interaction */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Burn Memory */}
          <form onSubmit={handleInject} style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '24px' }}>
            <div className="box-top" style={{ marginBottom: '20px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Flame size={14} /> BURN MEMORY</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--secondary)' }}>Type a rule. We&apos;ll permanently sear it into your AI&apos;s brain.</p>
            <textarea
              rows={4}
              value={injectText}
              onChange={e => setInjectText(e.target.value)}
              placeholder="e.g. 'Always use SurrealDB...'"
              style={{ width: '100%', padding: '14px', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', font: '13px monospace', resize: 'none', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <button type="submit" className="button small" disabled={isInjecting || !injectText.trim()} style={{ width: '100%', marginTop: '16px' }}>
              {isInjecting ? 'Burning...' : 'Inject into Hive Mind'}
            </button>
          </form>

          {/* Recall Memory */}
          <form onSubmit={handleRecall} style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '24px' }}>
            <div className="box-top" style={{ marginBottom: '20px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Search size={14} /> RECALL TEST</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--secondary)' }}>Test the retention. See if the brain actually works.</p>
            <input
              type="text"
              value={recallPrompt}
              onChange={e => setRecallPrompt(e.target.value)}
              placeholder="e.g. 'What DB do we use?'"
              style={{ width: '100%', padding: '14px', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', font: '13px monospace', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            {recallResult && (
              <div style={{ marginTop: '16px', padding: '16px', border: '1px solid var(--border)', background: 'var(--background)' }}>
                <div className="mono" style={{ fontSize: '10px', color: 'var(--accent)', marginBottom: '8px' }}>SYSTEM CORTEX CONTEXT:</div>
                <p style={{ margin: 0, fontSize: '12px', fontFamily: 'monospace', color: 'var(--foreground)', lineHeight: 1.5 }}>{recallResult}</p>
              </div>
            )}
            <button type="submit" className="button small ghost" disabled={isRecalling || !recallPrompt.trim()} style={{ width: '100%', marginTop: '16px' }}>
              {isRecalling ? 'Recalling...' : 'Test Memory Retrieval'}
            </button>
          </form>

        </div>
      </div>
    </div>
  )
}
