'use client'

import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { core, describeFailure, type EdgeDto, type MemoryDto } from '@/lib/core'
import { useCore } from '@/lib/use-core'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Float } from '@react-three/drei'
import * as THREE from 'three'
import { ArrowLeft } from 'lucide-react'

interface NeuronData {
  id: string
  label: string
  position: [number, number, number]
  retention: number
  locked: boolean
  isGlobal: boolean
  impact: number
  provenance: string
  accessCount: number
  fading: boolean
}

/**
 * Opt-in demo graph (`?demo=1`) for screenshots and the marketing page. It is
 * typed as the real DTOs on purpose — when the core's shape changes, this fails
 * to compile instead of quietly drifting, which is exactly what happened to the
 * hand-written constants it replaces.
 */
const DEMO_NODES: MemoryDto[] = [
  ['surrealdb', 'SurrealDB', 0.98, true, false, 9],
  ['postgres', 'PostgreSQL', 0.88, false, false, 7],
  ['tailwind', 'Tailwind v4', 0.99, true, false, 8],
  ['hono', 'Hono API', 0.72, false, false, 6],
  ['jwt', 'RS256 JWT', 0.91, true, false, 10],
  ['mongodb', 'MongoDB (dead)', 0.18, false, false, 2],
  ['mysql', 'Raw MySQL (dead)', 0.09, false, false, 2],
  ['react19', 'React 19 Actions', 0.99, true, true, 8],
  ['qdrant', 'Qdrant Vectors', 0.95, false, true, 6],
].map(([id, label, retention, locked, isGlobal, impact]) => ({
  id: String(id),
  label: String(label),
  category: 'concept',
  impact: Number(impact),
  stability: 1.4,
  weight_hint: Number(retention),
  locked: Boolean(locked),
  fading: Number(retention) < 0.35,
  retention: Number(retention),
  owner_uri: isGlobal ? 'cortex://global' : 'cortex://default',
  provenance: 'demo',
  access_count: 3,
  last_accessed: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})) as MemoryDto[]

const DEMO_EDGES: EdgeDto[] = [
  ['surrealdb', 'postgres', false],
  ['surrealdb', 'hono', false],
  ['tailwind', 'react19', false],
  ['hono', 'jwt', false],
  ['surrealdb', 'mongodb', true],
  ['postgres', 'mysql', true],
  ['surrealdb', 'qdrant', false],
].map(([source, target, historical]) => ({
  id: `edge:${source}-${historical ? 'was' : 'relates_to'}-${target}`,
  source: String(source),
  target: String(target),
  predicate: historical ? 'was_used' : 'relates_to',
  weight: historical ? 0 : 0.85,
  is_historical: Boolean(historical),
  impact: 5,
  locked: false,
}))

/** Scene-local edge shape: the canvas only needs endpoints + a colour hint. */
interface EdgeData {
  source: string
  target: string
  historical: boolean
}

function positionFor(index: number, total: number): [number, number, number] {
  // Fibonacci sphere: deterministic, and keeps 300 nodes legible instead of
  // stacking them on a plane the way the hardcoded positions did.
  const radius = total <= 12 ? 3.4 : Math.min(9, 3.4 + Math.sqrt(total) * 0.42)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const y = 1 - (index / Math.max(1, total - 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = golden * index
  return [Math.cos(theta) * ring * radius, y * radius * 0.72, Math.sin(theta) * ring * radius]
}

function toNeurons(nodes: MemoryDto[]): NeuronData[] {
  const ranked = nodes
    .slice()
    .sort((a, b) => b.impact * 10 + b.retention * 6 - (a.impact * 10 + a.retention * 6))
    .slice(0, 400)
  return ranked.map((node, index) => ({
    id: node.id,
    label: node.label,
    position: positionFor(index, ranked.length),
    retention: node.retention,
    locked: node.locked,
    isGlobal: node.owner_uri === 'cortex://global',
    impact: node.impact,
    provenance: node.provenance || 'unknown',
    accessCount: node.access_count,
    fading: node.fading,
  }))
}

function toEdges(edges: EdgeDto[] | undefined, visible: Set<string>): EdgeData[] {
  return (edges ?? [])
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target) && !edge.is_historical)
    .slice(0, 900)
    .map((edge) => ({ source: edge.source, target: edge.target, historical: edge.is_historical }))
}

function Neuron({ data, onClick }: { data: NeuronData; onClick: (n: NeuronData) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const color = data.locked ? '#f59e0b' : data.isGlobal ? '#a855f7' : data.retention < 0.35 ? '#475569' : '#06b6d4'
  const opacity = data.locked ? 1.0 : Math.max(0.3, data.retention)
  const scale = (data.locked ? 0.6 : 0.4 + data.retention * 0.3)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * 0.5 + data.position[0]) * 0.15
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2) * 0.15)
    }
  })

  return (
    <group position={data.position}>
      {/* Outer glow */}
      {(data.locked || hovered) && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[scale + 0.15, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={hovered ? 0.3 : 0.15} />
        </mesh>
      )}

      {/* Core sphere */}
      <mesh
        ref={meshRef}
        onClick={() => onClick(data)}
        onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
      >
        <sphereGeometry args={[scale, 32, 32]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={hovered ? 1 : opacity}
          emissive={color}
          emissiveIntensity={hovered ? 0.8 : data.locked ? 0.5 : 0.2}
        />
      </mesh>

      {/* Inner white dot */}
      <mesh>
        <sphereGeometry args={[scale * 0.25, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={opacity} />
      </mesh>

      {/* Label */}
      <Html center position={[0, -(scale + 0.35), 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        <div style={{
          color: hovered ? 'var(--accent)' : data.retention < 0.35 ? 'var(--secondary)' : 'var(--foreground)',
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: hovered ? 'bold' : 'normal',
          textShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}>
          {data.label}
        </div>
      </Html>

      {/* Retention tag on hover */}
      {hovered && (
        <Html center position={[0, -(scale + 0.7), 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div style={{
            color: color,
            fontFamily: 'monospace',
            fontSize: '10px',
            background: 'var(--surface)',
            padding: '2px 6px',
            border: `1px solid ${color}`,
            borderRadius: '4px'
          }}>
            {`R: ${(data.retention * 100).toFixed(0)}% ${data.locked ? '🔒 LOCKED' : '⚡ Ebbinghaus'}`}
          </div>
        </Html>
      )}
    </group>
  )
}

function SynapticEdge({ sourcePos, targetPos, historical }: { sourcePos: [number, number, number]; targetPos: [number, number, number]; historical: boolean }) {

  const points = useMemo(() => {
    const start = new THREE.Vector3(...sourcePos)
    const end = new THREE.Vector3(...targetPos)
    const mid = new THREE.Vector3().lerpVectors(start, end, 0.5)
    mid.y += 0.3
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    return curve.getPoints(30)
  }, [sourcePos, targetPos])

  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: historical ? '#334155' : '#06b6d4',
      transparent: true,
      opacity: historical ? 0.15 : 0.4,
    })
    return new THREE.Line(geometry, material)
  }, [points, historical])

  // R3F v9 + React 19 collide on the `line` JSX intrinsic (SVG's line), so the
  // object is built explicitly and handed to <primitive>. Also gives us a place
  // to dispose GPU resources when a node leaves the graph.
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line]
  )
  return <primitive object={line} />
}

function ElectricalPulse({ sourcePos, targetPos }: { sourcePos: [number, number, number]; targetPos: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const progress = useRef(Math.random())
  const speed = useRef(0.003 + Math.random() * 0.005)

  useFrame(() => {
    if (!meshRef.current) return
    progress.current += speed.current
    if (progress.current > 1) progress.current = 0

    const t = progress.current
    const start = new THREE.Vector3(...sourcePos)
    const end = new THREE.Vector3(...targetPos)
    const mid = new THREE.Vector3().lerpVectors(start, end, 0.5)
    mid.y += 0.3
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const point = curve.getPoint(t)
    meshRef.current.position.copy(point)
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshBasicMaterial color="#f59e0b" />
    </mesh>
  )
}

function Scene({ neurons, edges, onSelectNeuron }: { neurons: NeuronData[]; edges: EdgeData[]; onSelectNeuron: (n: NeuronData) => void }) {
  const neuronMap = useMemo(() => {
    const map: Record<string, NeuronData> = {}
    neurons.forEach(n => { map[n.id] = n })
    return map
  }, [neurons])

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#ff6b4a" />
      <pointLight position={[-5, -3, 3]} intensity={0.8} color="#06b6d4" />

      {/* Edges */}
      {edges.map((edge, i) => {
        const s = neuronMap[edge.source]
        const t = neuronMap[edge.target]
        if (!s || !t) return null
        return (
          <group key={`edge-${i}`}>
            <SynapticEdge sourcePos={s.position} targetPos={t.position} historical={edge.historical} />
            {!edge.historical && <ElectricalPulse sourcePos={s.position} targetPos={t.position} />}
          </group>
        )
      })}

      {/* Neurons */}
      {neurons.map(n => (
        <Float key={n.id} speed={0.5} rotationIntensity={0} floatIntensity={0.3}>
          <Neuron data={n} onClick={onSelectNeuron} />
        </Float>
      ))}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate
        autoRotateSpeed={0.3}
        maxDistance={15}
        minDistance={3}
      />
    </>
  )
}

export default function BrainPage() {
  const { state, stats, memories, message, refresh } = useCore({ intervalMs: 30_000, memoryLimit: 400 })
  const [demoMode, setDemoMode] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // window.location rather than useSearchParams: keeps this page prerenderable
    // without a Suspense boundary just for a screenshot flag.
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('demo') === '1') {
      setDemoMode(true)
    }
  }, [])

  const { neurons, edges } = useMemo(() => {
    if (demoMode) {
      const nodes = toNeurons(DEMO_NODES)
      return { neurons: nodes, edges: toEdges(DEMO_EDGES, new Set(nodes.map((n) => n.id))) }
    }
    const nodes = toNeurons(memories?.memories ?? [])
    return { neurons: nodes, edges: toEdges(memories?.edges, new Set(nodes.map((n) => n.id))) }
  }, [demoMode, memories])

  const selectedNeuron = useMemo(() => neurons.find((n) => n.id === selectedId) ?? null, [neurons, selectedId])

  const act = useCallback(
    async (kind: 'lock' | 'forget') => {
      if (!selectedNeuron || demoMode) return
      setBusy(true)
      setAction(null)
      const result =
        kind === 'lock'
          ? await core.lock(selectedNeuron.id, !selectedNeuron.locked)
          : await core.forget(selectedNeuron.id)
      setBusy(false)
      if (!result.ok) {
        setAction(describeFailure(result))
        return
      }
      setAction(kind === 'lock' ? (selectedNeuron.locked ? 'Unlocked — decay can fade it again' : 'Locked — exempt from decay forever') : `Forgot “${selectedNeuron.label}” and its edges`)
      if (kind === 'forget') setSelectedId(null)
      await refresh()
    },
    [selectedNeuron, demoMode, refresh]
  )

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--background)' }}>
      <Canvas camera={{ position: [0, 2, 8], fov: 50 }} style={{ width: '100%', height: '100%' }}>
        <Scene neurons={neurons} edges={edges} onSelectNeuron={(n) => setSelectedId(n.id)} />
      </Canvas>

      {/* Top-left status: what am I looking at, and is it my data? */}
      <div
        style={{
          position: 'absolute', top: 24, left: 24, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start',
        }}
      >
        <Link href="/dashboard" className="button small ghost" style={{ gap: 8 }}>
          <ArrowLeft size={14} /> Feed
        </Link>
        <span className="core-pill" style={{ background: 'var(--surface)' }}>
          <i />
          {demoMode
            ? 'DEMO GRAPH — not your data'
            : state === 'loading'
              ? 'LOADING GRAPH…'
              : state === 'offline' || state === 'denied' || state === 'error'
                ? 'CORE NOT REACHABLE'
                : `${neurons.length} NEURONS · ${edges.length} ACTIVE SYNAPSES`}
        </span>
        {demoMode ? (
          <span className="data-flag">remove ?demo=1 to view your real graph</span>
        ) : null}
      </div>

      {(state === 'offline' || state === 'denied' || state === 'error') && !demoMode ? (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 70, width: 'min(560px,90vw)' }}>
          <div className="state-card">
            <h3>This is your graph, so it is empty until the core answers</h3>
            <p>{message || 'The 3D view reads /v1/memories through the site’s proxy. Nothing is simulated here.'}</p>
            <div className="row">
              <button type="button" className="button small" onClick={() => void refresh()}>
                Retry
              </button>
              <Link href="/dashboard/docs" className="button small ghost">
                Setup docs
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {state === 'empty' && !demoMode ? (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 70, width: 'min(520px,90vw)' }}>
          <div className="state-card">
            <h3>No memories yet — the space you are looking at is honest</h3>
            <p>
              Store a fact from the feed, the MCP <code>cortex_remember</code> tool or the browser extension and it
              appears here on the next poll. For a screenshot of what this looks like populated, open{' '}
              <Link href="/dashboard/brain?demo=1" style={{ color: 'var(--accent)' }}>
                the demo graph
              </Link>
              .
            </p>
            <div className="row">
              <Link href="/dashboard" className="button small">
                Go to the feed
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Floating title */}
      <div style={{
        position: 'absolute', top: 24, right: 24, zIndex: 60,
        padding: '12px 18px', borderRadius: 4,
        background: 'var(--surface)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        font: '11px monospace', color: 'var(--secondary)', letterSpacing: '.12em'
      }}>
        <span style={{ color: 'var(--accent)', marginRight: '8px' }}>●</span>
        3D HIVE MIND • DRAG TO ORBIT{stats ? ` • ${stats.nodes} NODES TOTAL` : ''}
      </div>

      {/* Neuron Inspector (floating bottom-left) */}
      {selectedNeuron && (
        <div style={{
          position: 'absolute', bottom: 32, left: 32, zIndex: 60,
          width: 340, padding: 24, borderRadius: 0,
          background: 'var(--surface)', backdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, font: '11px monospace', letterSpacing: '.1em' }}>
            <span style={{ color: 'var(--secondary)' }}>{selectedNeuron.isGlobal ? 'cortex://global' : 'your namespace'}</span>
            <span style={{ color: selectedNeuron.locked ? 'var(--accent)' : '#06b6d4' }}>
              {selectedNeuron.locked ? '🔒 AMYGDALA LOCK' : '⚡ DYNAMIC'}
            </span>
          </div>
          <h3 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 800, letterSpacing: '-.05em' }}>{selectedNeuron.label}</h3>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: '10px monospace', marginBottom: 6 }}>
              <span style={{ color: 'var(--secondary)' }}>RETENTION (R)</span>
              <span style={{ color: selectedNeuron.retention > 0.6 ? '#22c55e' : 'var(--accent)' }}>{(selectedNeuron.retention * 100).toFixed(1)}%</span>
            </div>
            <div style={{ width: '100%', height: 4, background: 'var(--muted)', overflow: 'hidden' }}>
              <div style={{
                width: `${selectedNeuron.retention * 100}%`, height: '100%',
                background: selectedNeuron.locked ? 'var(--accent)' : selectedNeuron.retention > 0.6 ? '#22c55e' : '#64748b',
                transition: 'width .5s',
              }} />
            </div>
          </div>

          <p style={{ margin: '0 0 14px', font: '10px monospace', color: 'var(--secondary)', letterSpacing: '.06em' }}>
            IMPACT {selectedNeuron.impact}/10 · SEEN {selectedNeuron.accessCount}× · FROM {selectedNeuron.provenance.toUpperCase()}
            {selectedNeuron.fading ? ' · FADING' : ''}
          </p>

          {!demoMode ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => void act('lock')}
                disabled={busy}
                style={{ flex: 1, padding: '11px 0', border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', font: '11px monospace', letterSpacing: '.08em' }}
              >
                {busy ? 'WORKING…' : selectedNeuron.locked ? 'UNLOCK' : 'LOCK (NO DECAY)'}
              </button>
              <button
                type="button"
                onClick={() => void act('forget')}
                disabled={busy}
                style={{ flex: 1, padding: '11px 0', border: '1px solid #dc262655', background: 'transparent', color: '#dc2626', cursor: 'pointer', font: '11px monospace', letterSpacing: '.08em' }}
              >
                FORGET
              </button>
            </div>
          ) : null}

          {action ? <p style={{ margin: '0 0 10px', font: '10px monospace', color: 'var(--accent)' }}>{action}</p> : null}

          <button
            onClick={() => setSelectedId(null)}
            style={{
              width: '100%', marginTop: 8, padding: '12px 0',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--secondary)', cursor: 'pointer', font: '11px monospace', letterSpacing: '.1em'
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.borderColor = 'var(--foreground)' }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Legend (floating bottom-right) */}
      <div style={{
        position: 'absolute', bottom: 32, right: 32, zIndex: 60,
        padding: '16px 20px', borderRadius: 0,
        background: 'var(--surface)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        font: '10px monospace', color: 'var(--secondary)', letterSpacing: '.05em',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <span style={{ display: 'flex', alignItems: 'center' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginRight: 10 }} />AMYGDALA LOCK (100%)</span>
        <span style={{ display: 'flex', alignItems: 'center' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#06b6d4', marginRight: 10 }} />ACTIVE SYNAPSE</span>
        <span style={{ display: 'flex', alignItems: 'center' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#a855f7', marginRight: 10 }} />GLOBAL MESH</span>
        <span style={{ display: 'flex', alignItems: 'center', opacity: 0.5 }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#475569', marginRight: 10 }} />EBBINGHAUS DECAYED</span>
      </div>
    </div>
  )
}
