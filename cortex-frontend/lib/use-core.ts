'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { core, describeFailure, type Health, type MemoryList, type Stats } from './core'

export type PanelState = 'loading' | 'offline' | 'denied' | 'error' | 'empty' | 'ready'

export interface CoreSnapshot {
  state: PanelState
  health: Health | null
  stats: Stats | null
  memories: MemoryList | null
  message: string
  liveUpdates: boolean
  lastUpdated: number | null
  refresh: () => Promise<void>
  isRefreshing: boolean
}

/**
 * One data source for every dashboard surface.
 *
 * `state` is deliberately six-valued: the shipped version rendered the same
 * numbers whether the core was down, empty, or full, which is how a broken
 * install passed a visual review. `empty` (connected, no memories) must look
 * different from `offline` (no core) and from a hard `error`.
 */
export function useCore(options: { intervalMs?: number; memoryLimit?: number } = {}): CoreSnapshot {
  const intervalMs = options.intervalMs ?? 20_000
  const memoryLimit = options.memoryLimit ?? 200
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [memories, setMemories] = useState<MemoryList | null>(null)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<PanelState>('loading')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    setIsRefreshing(true)
    const [healthResult, statsResult, memoryResult] = await Promise.all([
      core.health(),
      core.stats(),
      core.memories({ limit: memoryLimit }),
    ])
    if (!mounted.current) return

    if (!healthResult.ok) {
      setHealth(null)
      setStats(null)
      setMemories(null)
      setState(healthResult.offline ? 'offline' : healthResult.status === 401 || healthResult.status === 403 ? 'denied' : 'error')
      setMessage(describeFailure(healthResult))
      setIsRefreshing(false)
      return
    }

    setHealth(healthResult.data)
    if (statsResult.ok) setStats(statsResult.data)
    if (memoryResult.ok) setMemories(memoryResult.data)

    if (!statsResult.ok || !memoryResult.ok) {
      const failure = !statsResult.ok ? statsResult : (memoryResult as { offline: boolean; code: string; message: string })
      setState(failure.offline ? 'offline' : 'error')
      setMessage(describeFailure(failure))
    } else if (statsResult.data.nodes === 0 && statsResult.data.edges === 0) {
      setState('empty')
      setMessage('')
    } else {
      setState('ready')
      setMessage('')
    }
    setLastUpdated(Date.now())
    setIsRefreshing(false)
  }, [memoryLimit])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = window.setInterval(() => {
      // Polling a localhost core is cheap, but not while the tab is hidden.
      if (document.visibilityState === 'visible') void load()
    }, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, intervalMs])

  // Live updates are opt-in: an https page cannot open ws://localhost, and a
  // failed socket on every mount is worse than an honest "polling" label.
  const liveUpdates = Boolean(process.env.NEXT_PUBLIC_CORTEX_WS_URL)

  return { state, health, stats, memories, message, liveUpdates, lastUpdated, refresh: load, isRefreshing }
}

/** Subscribes to the core's broadcast socket when one is configured. */
export function useCoreSocket(onEvent: (event: { type: string; at?: string }) => void, enabled: boolean) {
  const handler = useRef(onEvent)
  handler.current = onEvent
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CORTEX_WS_URL
    if (!enabled || !url) return
    let socket: WebSocket | null = null
    let closed = false
    let retry = 0

    const connect = () => {
      if (closed) return
      try {
        socket = new WebSocket(url)
      } catch {
        return
      }
      socket.onmessage = (event) => {
        try {
          handler.current(JSON.parse(String(event.data)))
        } catch {
          /* a non-JSON frame is not an error worth surfacing */
        }
      }
      socket.onclose = () => {
        if (closed) return
        retry = Math.min(retry + 1, 5)
        window.setTimeout(connect, 1000 * 2 ** retry)
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      closed = true
      socket?.close()
    }
  }, [enabled])
}

export function timeAgo(value: string | number | null | undefined): string {
  if (value == null) return '—'
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}
