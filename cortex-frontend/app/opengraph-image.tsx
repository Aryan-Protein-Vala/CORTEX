import { ImageResponse } from 'next/og'

export const alt = 'CORTEX — a memory graph that every AI model can read'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Shared Open Graph card, generated at build. Deliberately shows the real math
 * (counts, budget, retention) instead of a number nobody measured, because the
 * first thing a reviewer does with a claim like "0ms" is try to reproduce it.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background: 'linear-gradient(135deg, #050505 0%, #0f0a1f 55%, #1a0f2e 100%)',
          color: '#f5f3ff',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 22, height: 22, borderRadius: 22, background: '#a78bfa' }} />
          <div style={{ fontSize: 30, letterSpacing: 8, opacity: 0.85 }}>CORTEX</div>
          <div style={{ fontSize: 22, opacity: 0.5 }}>MEMORY LAYER FOR AI</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 76, lineHeight: 1.02, fontFamily: 'sans-serif', letterSpacing: -3 }}>
            Every AI you use,
          </div>
          <div style={{ fontSize: 76, lineHeight: 1.02, fontFamily: 'sans-serif', letterSpacing: -3, color: '#c4b5fd' }}>
            one brain they share.
          </div>
          <div style={{ fontSize: 30, opacity: 0.75, fontFamily: 'sans-serif', maxWidth: 900 }}>
            Conversations become a graph of facts and rules. MCP, the browser extension and your own scripts read the
            same memory back — on your machine, with your keys.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 40, fontSize: 24, opacity: 0.8 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#a78bfa', fontSize: 34 }}>1 binary</span>
            <span>no Docker, no queue</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#a78bfa', fontSize: 34 }}>400 tk</span>
            <span>budget enforced in code</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#a78bfa', fontSize: 34 }}>8 + 2</span>
            <span>MCP tools &amp; resources</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#a78bfa', fontSize: 34 }}>soft decay</span>
            <span>fading, never silent deletion</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
