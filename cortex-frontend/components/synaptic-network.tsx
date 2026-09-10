'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Sparkles, Zap, Lock, Unlock, RefreshCw, Eye, EyeOff, Search, ArrowUpRight } from 'lucide-react'

export interface NeuronNode {
  id: string
  label: string
  owner_uri: string
  stability: number
  access_count: number
  retention: number // 0.0 to 1.0 (Ebbinghaus retention)
  locked: boolean
  last_accessed: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

export interface SynapseEdge {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
  is_historical: boolean
}

interface SynapticNetworkProps {
  onSelectNode?: (node: NeuronNode | null) => void
  onPulseEvent?: (event: { type: string; message: string }) => void
  filterDecayed?: boolean
  showMesh?: boolean
}

// Pre-seeded high-aesthetic demo nodes in case backend is loading
const INITIAL_DEMO_NODES: NeuronNode[] = [
  { id: 'node:surrealdb', label: 'SurrealDB', owner_uri: 'cortex://user', stability: 2.8, access_count: 14, retention: 0.98, locked: true, last_accessed: 'Just now', x: 250, y: 220, vx: 0, vy: 0, radius: 18, color: '#f59e0b' },
  { id: 'node:postgres', label: 'PostgreSQL', owner_uri: 'cortex://user', stability: 1.9, access_count: 8, retention: 0.88, locked: false, last_accessed: '2h ago', x: 180, y: 340, vx: 0, vy: 0, radius: 14, color: '#06b6d4' },
  { id: 'node:tailwind4', label: 'Tailwind v4', owner_uri: 'cortex://user', stability: 3.1, access_count: 19, retention: 0.99, locked: true, last_accessed: 'Just now', x: 420, y: 190, vx: 0, vy: 0, radius: 17, color: '#f59e0b' },
  { id: 'node:hono', label: 'Hono API', owner_uri: 'cortex://user', stability: 1.4, access_count: 5, retention: 0.72, locked: false, last_accessed: '1d ago', x: 340, y: 360, vx: 0, vy: 0, radius: 13, color: '#06b6d4' },
  { id: 'node:jwt_auth', label: 'RS256 JWT Auth', owner_uri: 'cortex://user', stability: 2.2, access_count: 11, retention: 0.91, locked: true, last_accessed: '4h ago', x: 490, y: 310, vx: 0, vy: 0, radius: 15, color: '#f59e0b' },
  { id: 'node:mongodb_old', label: 'MongoDB (Deprecated)', owner_uri: 'cortex://user', stability: 0.4, access_count: 1, retention: 0.18, locked: false, last_accessed: '18d ago', x: 120, y: 150, vx: 0, vy: 0, radius: 9, color: '#64748b' },
  { id: 'node:mysql_old', label: 'Raw MySQL Joins', owner_uri: 'cortex://user', stability: 0.2, access_count: 1, retention: 0.09, locked: false, last_accessed: '32d ago', x: 110, y: 450, vx: 0, vy: 0, radius: 8, color: '#64748b' },
  { id: 'node:global_react19', label: 'React 19 Actions', owner_uri: 'cortex://global', stability: 4.5, access_count: 42, retention: 0.99, locked: true, last_accessed: 'Just now', x: 620, y: 220, vx: 0, vy: 0, radius: 16, color: '#a855f7' },
  { id: 'node:global_qdrant', label: 'Qdrant Vectors', owner_uri: 'cortex://global', stability: 3.8, access_count: 31, retention: 0.95, locked: false, last_accessed: '3h ago', x: 570, y: 390, vx: 0, vy: 0, radius: 15, color: '#a855f7' },
]

const INITIAL_DEMO_EDGES: SynapseEdge[] = [
  { id: 'e1', source: 'node:surrealdb', target: 'node:postgres', predicate: 'migrated_from', weight: 0.95, is_historical: false },
  { id: 'e2', source: 'node:surrealdb', target: 'node:hono', predicate: 'queried_by', weight: 0.88, is_historical: false },
  { id: 'e3', source: 'node:tailwind4', target: 'node:global_react19', predicate: 'styled_with', weight: 0.92, is_historical: false },
  { id: 'e4', source: 'node:hono', target: 'node:jwt_auth', predicate: 'secures', weight: 0.98, is_historical: false },
  { id: 'e5', source: 'node:surrealdb', target: 'node:mongodb_old', predicate: 'replaces', weight: 0.15, is_historical: true },
  { id: 'e6', source: 'node:postgres', target: 'node:mysql_old', predicate: 'replaced', weight: 0.08, is_historical: true },
  { id: 'e7', source: 'node:surrealdb', target: 'node:global_qdrant', predicate: 'syncs_embeddings', weight: 0.85, is_historical: false },
]

export function SynapticNetwork({
  onSelectNode,
  onPulseEvent,
  filterDecayed = false,
  showMesh = true
}: SynapticNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [nodes, setNodes] = useState<NeuronNode[]>(INITIAL_DEMO_NODES)
  const [edges, setEdges] = useState<SynapseEdge[]>(INITIAL_DEMO_EDGES)
  const [hoveredNode, setHoveredNode] = useState<NeuronNode | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false)
  const [pulses, setPulses] = useState<{ edgeId: string; progress: number; speed: number }[]>([])

  // Dragging state
  const draggingNodeRef = useRef<NeuronNode | null>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Fetch live graph from Cortex Core (http://localhost:3030/v1/resolve)
  const fetchLiveGraph = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3030/v1/resolve?uri=cortex://default&include_mesh=true')
      if (res.ok) {
        const data = await res.json()
        setIsBackendConnected(true)
        if (data.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) {
          // Merge live nodes with spatial positions
          setNodes(prev => {
            const width = canvasRef.current?.width || 800
            const height = canvasRef.current?.height || 600

            return data.nodes.map((n: any, idx: number) => {
              const existing = prev.find(p => p.id === n.id)
              const retention = typeof n.retention === 'number' ? n.retention : (n.locked ? 1.0 : Math.max(0.05, 1.0 - (idx * 0.12)))
              const isGlobal = (n.owner_uri || '').includes('global')
              const color = n.locked ? '#f59e0b' : (isGlobal ? '#a855f7' : (retention < 0.4 ? '#64748b' : '#06b6d4'))

              return {
                id: n.id,
                label: n.label || n.id,
                owner_uri: n.owner_uri || 'cortex://default',
                stability: n.stability || 1.5,
                access_count: n.access_count || 1,
                retention: retention,
                locked: !!n.locked,
                last_accessed: n.last_accessed || 'Recently',
                x: existing ? existing.x : 100 + ((idx * 90) % (width - 200)),
                y: existing ? existing.y : 100 + ((idx * 75) % (height - 200)),
                vx: existing ? existing.vx : (Math.random() - 0.5) * 0.4,
                vy: existing ? existing.vy : (Math.random() - 0.5) * 0.4,
                radius: n.locked ? 17 : Math.max(8, Math.round(10 + retention * 8)),
                color
              }
            })
          })

          if (data.edges && Array.isArray(data.edges)) {
            setEdges(data.edges)
          }
        }
      }
    } catch {
      // Backend not running on 3030, seamlessly running in interactive offline simulation
      setIsBackendConnected(false)
    }
  }, [])

  // Setup WebSocket live listener for real-time ingest synapse pulse
  useEffect(() => {
    fetchLiveGraph()
    const interval = setInterval(fetchLiveGraph, 4000)

    let ws: WebSocket | null = null
    try {
      ws = new WebSocket('ws://localhost:3030/ws')
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'WS_SYNAPSE_PULSE') {
            fetchLiveGraph()
            onPulseEvent?.({ type: 'SYNAPSE_PULSE', message: 'New memory ingested into Cortex Graph' })
          }
        } catch {
          // Pass
        }
      }
    } catch {
      // Pass
    }

    return () => {
      clearInterval(interval)
      if (ws) ws.close()
    }
  }, [fetchLiveGraph, onPulseEvent])

  // Spawn periodic electrical pulses along edges for biological visualization
  useEffect(() => {
    const pulseTimer = setInterval(() => {
      if (edges.length === 0) return
      const randomEdge = edges[Math.floor(Math.random() * edges.length)]
      if (randomEdge && !randomEdge.is_historical) {
        setPulses(prev => [...prev.slice(-15), { edgeId: randomEdge.id, progress: 0, speed: 0.015 + Math.random() * 0.02 }])
      }
    }, 450)

    return () => clearInterval(pulseTimer)
  }, [edges])

  // Canvas render & physics loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const render = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      ctx.clearRect(0, 0, width, height)

      // Background subtle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
      ctx.lineWidth = 1
      const gridSize = 40
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Filter nodes based on user settings
      const visibleNodes = nodes.filter(node => {
        if (filterDecayed && node.retention < 0.35 && !node.locked) return false
        if (!showMesh && node.owner_uri.includes('global')) return false
        return true
      })
      const visibleNodeIds = new Set(visibleNodes.map(n => n.id))

      // Physics Relaxation
      visibleNodes.forEach(node => {
        if (node === draggingNodeRef.current) {
          node.x = mousePosRef.current.x
          node.y = mousePosRef.current.y
          node.vx = 0
          node.vy = 0
          return
        }

        // Gentle floating motion
        node.x += node.vx
        node.y += node.vy

        // Soft bounce against canvas bounds
        const padding = 40
        if (node.x < padding) { node.x = padding; node.vx *= -1 }
        if (node.x > width - padding) { node.x = width - padding; node.vx *= -1 }
        if (node.y < padding) { node.y = padding; node.vy *= -1 }
        if (node.y > height - padding) { node.y = height - padding; node.vy *= -1 }

        // Node repulsion
        visibleNodes.forEach(other => {
          if (node.id === other.id) return
          const dx = node.x - other.x
          const dy = node.y - other.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          if (dist < 120) {
            const force = (120 - dist) / dist * 0.08
            node.vx += dx * force
            node.vy += dy * force
          }
        })

        // Damping
        node.vx *= 0.94
        node.vy *= 0.94
      })

      // 1. Draw Synaptic Edges
      edges.forEach(edge => {
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return
        const source = visibleNodes.find(n => n.id === edge.source)
        const target = visibleNodes.find(n => n.id === edge.target)
        if (!source || !target) return

        const isHovered = hoveredNode?.id === source.id || hoveredNode?.id === target.id
        const isHistorical = edge.is_historical

        // Synaptic line styling based on retention and historical state
        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        
        // Slight curved bezier for biological feel
        const mx = (source.x + target.x) / 2
        const my = (source.y + target.y) / 2 - 15
        ctx.quadraticCurveTo(mx, my, target.x, target.y)

        if (isHistorical) {
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.15)'
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1
        } else {
          ctx.setLineDash([])
          const edgeAlpha = Math.min(source.retention, target.retention) * (isHovered ? 0.9 : 0.45)
          ctx.strokeStyle = isHovered ? '#ff6b4a' : `rgba(6, 182, 212, ${Math.max(0.12, edgeAlpha)})`
          ctx.lineWidth = isHovered ? 2.5 : Math.max(1, edge.weight * 2)
        }
        ctx.stroke()
        ctx.setLineDash([])

        // Draw predicate label on hover
        if (isHovered) {
          ctx.font = '10px monospace'
          ctx.fillStyle = '#ff6b4a'
          ctx.fillText(edge.predicate, mx, my - 6)
        }
      })

      // 2. Draw Electrical Synapse Pulses
      pulses.forEach(pulse => {
        const edge = edges.find(e => e.id === pulse.edgeId)
        if (!edge || edge.is_historical) return
        const source = visibleNodes.find(n => n.id === edge.source)
        const target = visibleNodes.find(n => n.id === edge.target)
        if (!source || !target) return

        const t = pulse.progress
        const px = (1 - t) * (1 - t) * source.x + 2 * (1 - t) * t * ((source.x + target.x) / 2) + t * t * target.x
        const py = (1 - t) * (1 - t) * source.y + 2 * (1 - t) * t * (((source.y + target.y) / 2) - 15) + t * t * target.y

        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = '#f59e0b'
        ctx.shadowColor = '#f59e0b'
        ctx.shadowBlur = 10
        ctx.fill()
        ctx.shadowBlur = 0
      })

      // Update pulse progress
      setPulses(prev => prev.map(p => ({ ...p, progress: p.progress + p.speed })).filter(p => p.progress < 1.0))

      // 3. Draw Neuron Nodes
      visibleNodes.forEach(node => {
        const isHovered = hoveredNode?.id === node.id
        const isSelected = selectedNodeId === node.id
        
        // Ebbinghaus opacity calculation: Lower retention = lower opacity!
        // Decayed nodes drop to 0.25 opacity, active nodes stay 1.0
        const baseAlpha = node.locked ? 1.0 : Math.max(0.2, node.retention)
        const nodeAlpha = isHovered ? 1.0 : baseAlpha

        // Glowing outer halo
        if (node.locked || isHovered || isSelected) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.radius + (isHovered ? 8 : 4), 0, Math.PI * 2)
          ctx.fillStyle = node.locked
            ? `rgba(245, 158, 11, ${isHovered ? 0.4 : 0.2})`
            : `rgba(6, 182, 212, ${isHovered ? 0.35 : 0.15})`
          ctx.fill()
        }

        // Node core circle
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
        ctx.fillStyle = node.color
        ctx.globalAlpha = nodeAlpha
        ctx.fill()
        ctx.globalAlpha = 1.0

        // White inner synapse dot
        ctx.beginPath()
        ctx.arc(node.x, node.y, Math.max(2, node.radius * 0.25), 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = nodeAlpha
        ctx.fill()
        ctx.globalAlpha = 1.0

        // Lock icon representation for Amygdala Invariants
        if (node.locked) {
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2)
          ctx.stroke()
        }

        // Node Text Label
        ctx.font = `${isHovered ? 'bold 12px' : '11px'} monospace`
        ctx.fillStyle = isHovered ? '#ffffff' : (nodeAlpha < 0.4 ? '#64748b' : '#e2e8f0')
        ctx.textAlign = 'center'
        ctx.fillText(node.label, node.x, node.y + node.radius + 14)

        // Ebbinghaus retention percentage tag (small)
        if (isHovered || isSelected) {
          ctx.font = '9px monospace'
          ctx.fillStyle = node.locked ? '#f59e0b' : '#06b6d4'
          ctx.fillText(`R: ${(node.retention * 100).toFixed(0)}% (${node.locked ? 'LOCKED' : 'Ebbinghaus'})`, node.x, node.y + node.radius + 26)
        }
      })

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => cancelAnimationFrame(animationFrameId)
  }, [nodes, edges, hoveredNode, selectedNodeId, pulses, filterDecayed, showMesh])

  // Mouse Interaction handlers
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    mousePosRef.current = { x, y }

    const hit = nodes.find(n => {
      const dx = n.x - x
      const dy = n.y - y
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6
    })

    setHoveredNode(hit || null)
  }

  const handleMouseDown = () => {
    if (hoveredNode) {
      draggingNodeRef.current = hoveredNode
      setSelectedNodeId(hoveredNode.id)
      onSelectNode?.(hoveredNode)
    }
  }

  const handleMouseUp = () => {
    draggingNodeRef.current = null
  }

  return (
    <div className="relative w-full h-[620px] rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-xl overflow-hidden shadow-2xl">
      {/* Top Overlay Controls & Status */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 bg-zinc-900/90 border border-zinc-800 px-3.5 py-1.5 rounded-full pointer-events-auto shadow-lg backdrop-blur-md">
          <div className={`w-2.5 h-2.5 rounded-full ${isBackendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-xs font-mono tracking-wide text-zinc-300">
            {isBackendConnected ? 'CORTEX CORE ONLINE (:3030)' : 'SIMULATION MESH (LOCAL RUNNER)'}
          </span>
        </div>

        <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 p-1 rounded-xl pointer-events-auto shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Amygdala Lock (100%)
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-cyan-500" /> Active Synapse
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-zinc-600 opacity-40" /> Ebbinghaus Decayed
          </div>
        </div>
      </div>

      {/* Main Interactive Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />

      {/* Bottom Floating Hint */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none text-xs font-mono text-zinc-500 flex items-center gap-2">
        <span>💡 Click & drag neurons to explore synaptic links. Hover to inspect Ebbinghaus retention decay.</span>
      </div>
    </div>
  )
}
