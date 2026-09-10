'use client'

import { useState } from 'react'
import { Terminal, Copy, Check, ArrowRight, Code2 } from 'lucide-react'

function CopyBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div style={{ border: '1px solid var(--border)', background: '#0a0a0a', marginTop: '20px' }}>
      <div className="box-top" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <span>{lang.toUpperCase()}</span>
        <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 0, color: 'var(--secondary)', cursor: 'pointer', font: 'inherit' }}>
          {copied ? <><Check size={12} color="#22c55e" /> <span style={{ color: '#22c55e' }}>COPIED</span></> : <><Copy size={12} /> COPY</>}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '20px', overflowX: 'auto', font: '13px monospace', color: '#e5e7eb' }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<'quickstart' | 'api'>('quickstart')

  return (
    <div className="wrap" style={{ paddingTop: '60px', paddingBottom: '60px' }}>
      <header style={{ marginBottom: '60px' }}>
        <p className="eyebrow" style={{ color: 'var(--accent)' }}>DEVELOPER DOCS / 02</p>
        <h1 style={{ fontSize: 'clamp(42px,5vw,70px)', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.06em', lineHeight: .98 }}>
          Integration is <em>easy.</em>
        </h1>
        <p className="lead" style={{ maxWidth: '600px', margin: '20px 0 30px' }}>
          Everything you need to inject Cortex into your workflow. Don&apos;t overcomplicate it.
        </p>

        <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '20px' }}>
          <button 
            className={`button small ${activeTab === 'quickstart' ? '' : 'ghost'}`} 
            onClick={() => setActiveTab('quickstart')}
          >
            <Terminal size={14}/> Setup & IDEs
          </button>
          <button 
            className={`button small ${activeTab === 'api' ? '' : 'ghost'}`} 
            onClick={() => setActiveTab('api')}
          >
            <Code2 size={14}/> REST API
          </button>
        </div>
      </header>

      {activeTab === 'quickstart' && (
        <div className="timeline">
          
          <div className="step">
            <div className="step-marker">01</div>
            <div>
              <p className="mono">THE ENGINE</p>
              <h3>Start Cortex Core</h3>
              <p>This is the Rust backend. It&apos;s the brain. Without it, your AI is a vegetable.</p>
              <CopyBlock code={`cd cortex-core\ncargo run`} />
            </div>
            <div className="step-art" style={{ opacity: 1, paddingLeft: '40px' }}>
              <div style={{ padding: '20px', border: '1px solid var(--border)', background: 'var(--surface)', font: '12px monospace' }}>
                <span style={{ color: '#22c55e' }}>✔</span> Engine running on port 3030<br/>
                <span style={{ color: '#22c55e' }}>✔</span> SurrealDB connected<br/>
                <span style={{ color: '#22c55e' }}>✔</span> Qdrant vectors ready
              </div>
            </div>
          </div>

          <div className="step">
            <div className="step-marker">02</div>
            <div>
              <p className="mono">CURSOR / WINDSURF</p>
              <h3>Attach the MCP</h3>
              <p>Give your IDE a permanent brain. Open your MCP settings (`~/.cursor/mcp.json`) and paste this config.</p>
              <CopyBlock lang="json" code={`{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/cortex-mcp/index.js"],
      "env": {
        "CORTEX_API_URL": "http://localhost:3030"
      }
    }
  }
}`} />
            </div>
            <div className="step-art" style={{ opacity: 1, paddingLeft: '40px' }}>
              <div style={{ padding: '20px', border: '1px dashed var(--accent)', background: 'color-mix(in srgb, var(--accent) 5%, transparent)' }}>
                <p style={{ margin: '0 0 10px', fontWeight: 'bold', color: 'var(--foreground)' }}>Cursor Superpowers Unlocked:</p>
                <ul style={{ margin: 0, paddingLeft: '20px', font: '12px monospace', color: 'var(--secondary)' }}>
                  <li style={{ marginBottom: '8px' }}><code>fetch_cortex_memory</code> (Auto-reads your rules)</li>
                  <li><code>store_cortex_memory</code> (Saves new facts forever)</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="step">
            <div className="step-marker">03</div>
            <div>
              <p className="mono">BROWSER EXTENSION</p>
              <h3>Inject into ChatGPT</h3>
              <p>Load the unpacked `cortex-extension` folder in Chrome. It invisibly intercepts prompts and injects your graph context.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '25px', font: '12px monospace', color: 'var(--secondary)' }}>
                <span style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)' }}>Prompt</span>
                <ArrowRight size={12} />
                <span style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>Cortex Injection</span>
                <ArrowRight size={12} />
                <span style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)' }}>OpenAI</span>
              </div>
            </div>
            <div className="step-art" />
          </div>

        </div>
      )}

      {activeTab === 'api' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '40px', alignItems: 'start', paddingBottom: '40px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <span style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', padding: '4px 8px', font: 'bold 11px monospace' }}>POST</span>
                <span className="mono" style={{ color: 'var(--foreground)', fontSize: '14px' }}>/v1/ingest</span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--secondary)', lineHeight: 1.6 }}>Store a memory into the Cortex graph. It will be vectorized, parsed into JSON-LD, and mapped in SurrealDB.</p>
            </div>
            <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/ingest \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": "default_user", "prompt": "Always use Tailwind v4"}'`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '40px', alignItems: 'start', paddingBottom: '40px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <span style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', padding: '4px 8px', font: 'bold 11px monospace' }}>POST</span>
                <span className="mono" style={{ color: 'var(--foreground)', fontSize: '14px' }}>/v1/recall</span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--secondary)', lineHeight: 1.6 }}>Retrieve relevant memory context for a prompt. Extremely fast Qdrant vector search combined with graph traversal.</p>
            </div>
            <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/recall \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": "default_user", "prompt": "What CSS framework?", "token_budget": 500}'`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '40px', alignItems: 'start', paddingBottom: '40px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <span style={{ background: 'color-mix(in srgb, #22c55e 15%, transparent)', color: '#22c55e', border: '1px solid color-mix(in srgb, #22c55e 30%, transparent)', padding: '4px 8px', font: 'bold 11px monospace' }}>GET</span>
                <span className="mono" style={{ color: 'var(--foreground)', fontSize: '14px' }}>/health</span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--secondary)', lineHeight: 1.6 }}>Check if the brain is alive and responding.</p>
            </div>
            <CopyBlock lang="bash" code={`curl http://localhost:3030/health`} />
          </div>

        </div>
      )}
    </div>
  )
}
