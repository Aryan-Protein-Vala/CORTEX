'use client'

import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Float, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { ArrowLeft } from 'lucide-react'

interface NeuronData {
  id: string
  label: string
  position: [number, number, number]
  retention: number
  locked: boolean
  isGlobal: boolean
}

interface EdgeData {
  source: string
  target: string
  historical: boolean
}

const DEMO_NEURONS: NeuronData[] = [
  { id: 'surrealdb', label: 'SurrealDB', position: [0, 1, 0], retention: 0.98, locked: true, isGlobal: false },
  { id: 'postgres', label: 'PostgreSQL', position: [-2, -0.5, 1], retention: 0.88, locked: false, isGlobal: false },
  { id: 'tailwind', label: 'Tailwind v4', position: [2.5, 0.8, -0.5], retention: 0.99, locked: true, isGlobal: false },
  { id: 'hono', label: 'Hono API', position: [1, -1.5, 2], retention: 0.72, locked: false, isGlobal: false },
  { id: 'jwt', label: 'RS256 JWT', position: [3, -0.3, 1.5], retention: 0.91, locked: true, isGlobal: false },
  { id: 'mongodb', label: 'MongoDB (Dead)', position: [-3, 2, -1], retention: 0.18, locked: false, isGlobal: false },
  { id: 'mysql', label: 'Raw MySQL (RIP)', position: [-2.5, -2, -2], retention: 0.09, locked: false, isGlobal: false },
  { id: 'react19', label: 'React 19 Actions', position: [4, 1.5, -1], retention: 0.99, locked: true, isGlobal: true },
  { id: 'qdrant', label: 'Qdrant Vectors', position: [3.5, -1.8, -0.5], retention: 0.95, locked: false, isGlobal: true },
]

const DEMO_EDGES: EdgeData[] = [
  { source: 'surrealdb', target: 'postgres', historical: false },
  { source: 'surrealdb', target: 'hono', historical: false },
  { source: 'tailwind', target: 'react19', historical: false },
  { source: 'hono', target: 'jwt', historical: false },
  { source: 'surrealdb', target: 'mongodb', historical: true },
  { source: 'postgres', target: 'mysql', historical: true },
  { source: 'surrealdb', target: 'qdrant', historical: false },
]

function Neuron({ data, onClick }: { data: NeuronData; onClick: (n: NeuronData) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const color = data.locked ? '#f59e0b' : data.isGlobal ? '#a855f7' : data.retention < 0.35 ? '#475569' : '#06b6d4'
  const opacity = data.locked ? 1.0 : Math.max(0.2, data.retention)
  const scale = data.locked ? 0.35 : 0.15 + data.retention * 0.2

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * 0.5 + data.position[0]) * 0.08
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
      <Text
        position={[0, -(scale + 0.25), 0]}
        fontSize={0.15}
        color={hovered ? '#ffffff' : data.retention < 0.35 ? '#64748b' : '#e2e8f0'}
        anchorX="center"
        anchorY="top"
        font="/fonts/inter.woff"
        outlineWidth={0}
      >
        {data.label}
      </Text>

      {/* Retention tag on hover */}
      {hovered && (
        <Text
          position={[0, -(scale + 0.45), 0]}
          fontSize={0.1}
          color={color}
          anchorX="center"
          anchorY="top"
        >
          {`R: ${(data.retention * 100).toFixed(0)}% ${data.locked ? '🔒 LOCKED' : '⚡ Ebbinghaus'}`}
        </Text>
      )}
    </group>
  )
}

function SynapticEdge({ sourcePos, targetPos, historical }: { sourcePos: [number, number, number]; targetPos: [number, number, number]; historical: boolean }) {
  const lineRef = useRef<THREE.Line>(null)

  const points = useMemo(() => {
    const start = new THREE.Vector3(...sourcePos)
    const end = new THREE.Vector3(...targetPos)
    const mid = new THREE.Vector3().lerpVectors(start, end, 0.5)
    mid.y += 0.3
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    return curve.getPoints(30)
  }, [sourcePos, targetPos])

  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points])

  return (
    <line ref={lineRef} geometry={geometry}>
      <lineBasicMaterial
        color={historical ? '#334155' : '#06b6d4'}
        transparent
        opacity={historical ? 0.15 : 0.4}
        linewidth={1}
      />
    </line>
  )
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
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.8} color="#ff6b4a" />
      <pointLight position={[-5, -3, 3]} intensity={0.5} color="#06b6d4" />

      <Stars radius={100} depth={50} count={2000} factor={3} saturation={0} fade speed={0.5} />

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
  const [selectedNeuron, setSelectedNeuron] = useState<NeuronData | null>(null)
  const [neurons] = useState<NeuronData[]>(DEMO_NEURONS)
  const [edges] = useState<EdgeData[]>(DEMO_EDGES)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50 }}>
      {/* The 3D Canvas — fills the entire screen */}
      <Canvas camera={{ position: [0, 2, 8], fov: 50 }} style={{ width: '100%', height: '100%' }}>
        <Scene neurons={neurons} edges={edges} onSelectNeuron={setSelectedNeuron} />
      </Canvas>

      {/* Back to Dashboard floating button */}
      <Link
        href="/dashboard"
        style={{
          position: 'absolute', top: 24, left: 24, zIndex: 60,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 10,
          background: 'rgba(10,10,10,0.8)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#fff', font: '12px monospace', textDecoration: 'none',
          transition: 'all .2s',
        }}
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </Link>

      {/* Floating title */}
      <div style={{
        position: 'absolute', top: 24, right: 24, zIndex: 60,
        padding: '12px 18px', borderRadius: 4,
        background: 'rgba(10,10,10,0.8)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        font: '11px monospace', color: 'var(--secondary)', letterSpacing: '.12em'
      }}>
        <span style={{ color: 'var(--accent)', marginRight: '8px' }}>●</span>
        3D HIVE MIND • DRAG TO ORBIT
      </div>

      {/* Neuron Inspector (floating bottom-left) */}
      {selectedNeuron && (
        <div style={{
          position: 'absolute', bottom: 32, left: 32, zIndex: 60,
          width: 340, padding: 24, borderRadius: 0,
          background: 'rgba(10,10,10,0.9)', backdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, font: '11px monospace', letterSpacing: '.1em' }}>
            <span style={{ color: 'var(--secondary)' }}>{selectedNeuron.isGlobal ? 'cortex://global' : 'cortex://user'}</span>
            <span style={{ color: selectedNeuron.locked ? 'var(--accent)' : '#06b6d4' }}>
              {selectedNeuron.locked ? '🔒 AMYGDALA LOCK' : '⚡ DYNAMIC'}
            </span>
          </div>
          <h3 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 800, letterSpacing: '-.05em' }}>{selectedNeuron.label}</h3>

          {/* Retention bar */}
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

          <button
            onClick={() => setSelectedNeuron(null)}
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
        background: 'rgba(10,10,10,0.8)', backdropFilter: 'blur(12px)',
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
