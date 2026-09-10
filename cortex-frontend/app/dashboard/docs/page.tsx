'use client'

import { useState } from 'react'
import { Copy, Check, Terminal, Code2, Zap, ArrowRight } from 'lucide-react'

function CopyBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="mono">{lang.toUpperCase()}</span>
        <button onClick={handleCopy} className="code-copy-btn">{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<'quickstart' | 'mcp' | 'extension' | 'sdk' | 'api'>('quickstart')

  const sections = [
    { id: 'quickstart' as const, label: '🚀 Quick Start', icon: Zap },
    { id: 'mcp' as const, label: '🔌 Cursor / MCP', icon: Terminal },
    { id: 'extension' as const, label: '🧩 Chrome Ext', icon: Code2 },
    { id: 'sdk' as const, label: '📦 SDKs', icon: Code2 },
    { id: 'api' as const, label: '⚡ REST API', icon: ArrowRight },
  ]

  return (
    <div className="docs-page">
      <header className="docs-header">
        <h1 className="docs-title">&lt;/&gt; Developer Docs</h1>
        <p className="docs-subtitle">Everything you need to make your AI stop being brain-dead. Read carefully or suffer.</p>
      </header>

      {/* Section Tabs */}
      <div className="docs-tabs">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} className={`docs-tab ${activeSection === s.id ? 'active' : ''}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* QUICKSTART */}
      {activeSection === 'quickstart' && (
        <div className="docs-section">
          <h2>Get Cortex Running in 60 Seconds</h2>
          <p>Stop wasting time. Here&apos;s the fastest path to giving your AI a permanent brain.</p>

          <h3>Step 1: Start the Cortex Core Engine</h3>
          <p>This is the Rust backend. It&apos;s the brain. Without it, your AI is a vegetable.</p>
          <CopyBlock code={`cd cortex-core\ncargo run`} />

          <h3>Step 2: Start the Frontend Dashboard</h3>
          <p>So you can actually see what&apos;s happening inside the brain instead of staring at a terminal like a caveman.</p>
          <CopyBlock code={`cd cortex-frontend\nnpm run dev`} />

          <h3>Step 3: Open your browser</h3>
          <p>Go to <code>http://localhost:3000/dashboard</code>. Congratulations, your AI now has a brain. It took you less time than making coffee.</p>

          <div className="docs-callout">
            <strong>⚡ Pro tip:</strong> The Cortex Core needs SurrealDB running. If you don&apos;t have it, install it with <code>curl -sSf https://install.surrealdb.com | sh</code> and run <code>surreal start --user root --pass root</code>.
          </div>
        </div>
      )}

      {/* MCP / CURSOR */}
      {activeSection === 'mcp' && (
        <div className="docs-section">
          <h2>Cursor / Windsurf / Claude Desktop (MCP)</h2>
          <p>This is the &quot;holy shit&quot; moment. Your coding AI will remember everything across sessions.</p>

          <h3>Add Cortex to Cursor</h3>
          <p>Open your Cursor MCP settings (<code>~/.cursor/mcp.json</code>) and paste this:</p>
          <CopyBlock lang="json" code={JSON.stringify({
            mcpServers: {
              cortex: {
                command: "node",
                args: ["/path/to/cortex-mcp/index.js"],
                env: {
                  CORTEX_API_URL: "http://localhost:3030"
                }
              }
            }
          }, null, 2)} />

          <h3>What happens next</h3>
          <p>Cursor now has two new superpowers:</p>
          <ul>
            <li><code>fetch_cortex_memory</code> — Automatically recalls your preferences, rules, and context</li>
            <li><code>store_cortex_memory</code> — Permanently saves important facts into the graph</li>
          </ul>
          <p>Tell Cursor <em>&quot;I always use SurrealDB for graph relations&quot;</em> once. It will never forget. Ever. Even if you switch to Claude Desktop tomorrow.</p>

          <h3>Add Cortex to Claude Desktop</h3>
          <p>Same config, different file. Open <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:</p>
          <CopyBlock lang="json" code={JSON.stringify({
            mcpServers: {
              cortex: {
                command: "node",
                args: ["/path/to/cortex-mcp/index.js"],
                env: { CORTEX_API_URL: "http://localhost:3030" }
              }
            }
          }, null, 2)} />
        </div>
      )}

      {/* CHROME EXTENSION */}
      {activeSection === 'extension' && (
        <div className="docs-section">
          <h2>Chrome Extension (ChatGPT + Claude.ai)</h2>
          <p>This injects your brain directly into ChatGPT and Claude. They&apos;ll finally stop asking you the same stupid questions.</p>

          <h3>Install the Extension</h3>
          <ol>
            <li>Open Chrome → <code>chrome://extensions</code></li>
            <li>Enable &quot;Developer mode&quot; (top right)</li>
            <li>Click &quot;Load unpacked&quot; → Select the <code>cortex-extension</code> folder</li>
            <li>Done. Go to ChatGPT.com or Claude.ai.</li>
          </ol>

          <h3>How it works (you don&apos;t have to do anything)</h3>
          <div className="docs-flow">
            <div className="docs-flow-step">
              <span className="docs-flow-num">1</span>
              <div>
                <strong>You type a prompt</strong>
                <p>The extension intercepts it before it reaches OpenAI/Anthropic</p>
              </div>
            </div>
            <div className="docs-flow-step">
              <span className="docs-flow-num">2</span>
              <div>
                <strong>Cortex recalls your memory</strong>
                <p>Fetches relevant context from the graph in under 600ms</p>
              </div>
            </div>
            <div className="docs-flow-step">
              <span className="docs-flow-num">3</span>
              <div>
                <strong>Memory is injected into the prompt</strong>
                <p>A <code>[SYSTEM CORTEX CONTEXT]</code> block is prepended invisibly</p>
              </div>
            </div>
            <div className="docs-flow-step">
              <span className="docs-flow-num">4</span>
              <div>
                <strong>AI responds with full context</strong>
                <p>The response is then auto-ingested back into Cortex. Full loop.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SDKs */}
      {activeSection === 'sdk' && (
        <div className="docs-section">
          <h2>SDKs: cortex-js &amp; cortex-py</h2>
          <p>Two lines of code to give any app permanent cross-platform memory.</p>

          <h3>JavaScript / TypeScript</h3>
          <CopyBlock lang="bash" code="npm install @cortex-ai/sdk" />
          <CopyBlock lang="javascript" code={`import { CortexClient } from '@cortex-ai/sdk'

const cortex = new CortexClient({
  apiUrl: 'http://localhost:3030',
  apiKey: 'your-api-key' // optional for local
})

// Store a memory
await cortex.ingest('User prefers PostgreSQL over MongoDB')

// Recall context for a prompt
const ctx = await cortex.recall('What database should I use?')
console.log(ctx.briefing)
// → "User prefers PostgreSQL. SurrealDB is the primary graph DB."`} />

          <h3>Python</h3>
          <CopyBlock lang="bash" code="pip install cortex-ai" />
          <CopyBlock lang="python" code={`from cortex import CortexClient

cortex = CortexClient(api_url="http://localhost:3030")

# Store a memory
cortex.ingest("Always use FastAPI with Pydantic v2")

# Recall context
ctx = cortex.recall("How should I structure the API?")
print(ctx["briefing"])
# → "User requires FastAPI with Pydantic v2 validation."`} />
        </div>
      )}

      {/* REST API */}
      {activeSection === 'api' && (
        <div className="docs-section">
          <h2>REST API Reference</h2>
          <p>For when you want to talk to the brain directly. Raw HTTP. No bullshit.</p>

          <h3><span className="api-method post">POST</span> /v1/ingest</h3>
          <p>Store a memory into the Cortex graph.</p>
          <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/ingest \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": "default_user", "prompt": "Always use Tailwind v4"}'`} />

          <h3><span className="api-method post">POST</span> /v1/recall</h3>
          <p>Retrieve relevant memory context for a prompt.</p>
          <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/recall \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": "default_user", "prompt": "What CSS framework?", "token_budget": 500}'`} />

          <h3><span className="api-method get">GET</span> /v1/resolve</h3>
          <p>Resolve a cortex:// URI and retrieve its graph context.</p>
          <CopyBlock lang="bash" code={`curl "http://localhost:3030/v1/resolve?uri=cortex://user&include_mesh=true"`} />

          <h3><span className="api-method post">POST</span> /v1/mesh/publish</h3>
          <p>Publish knowledge to the global decentralized mesh.</p>
          <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/mesh/publish \\
  -H "Content-Type: application/json" \\
  -d '{"nodes": [...], "edges": [...]}'`} />

          <h3><span className="api-method post">POST</span> /v1/sweep</h3>
          <p>Trigger an Ebbinghaus decay sweep. Kills stale memories.</p>
          <CopyBlock lang="bash" code={`curl -X POST http://localhost:3030/v1/sweep`} />

          <h3><span className="api-method get">GET</span> /health</h3>
          <p>Check if the brain is alive.</p>
          <CopyBlock lang="bash" code={`curl http://localhost:3030/health`} />
        </div>
      )}

      <style jsx>{`
        .docs-page { padding: 32px 40px; max-width: 900px; }
        .docs-header { margin-bottom: 28px; }
        .docs-title { margin: 0; font-size: clamp(32px, 4vw, 48px); font-weight: 800; letter-spacing: -.06em; }
        .docs-subtitle { margin: 6px 0 0; font: 13px monospace; color: var(--secondary); }

        .docs-tabs { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin-bottom: 24px; flex-wrap: wrap; }
        .docs-tab { padding: 8px 14px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; font: 12px monospace; font-weight: 600; color: var(--secondary); transition: all .2s; }
        .docs-tab:hover { color: var(--foreground); }
        .docs-tab.active { background: var(--accent); color: var(--accent-contrast); }

        .docs-section h2 { font-size: 28px; font-weight: 800; letter-spacing: -.04em; margin: 0 0 8px; }
        .docs-section h3 { font-size: 18px; font-weight: 700; margin: 28px 0 8px; display: flex; align-items: center; gap: 8px; }
        .docs-section p { color: var(--secondary); font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
        .docs-section ul, .docs-section ol { color: var(--secondary); font-size: 14px; line-height: 1.8; padding-left: 20px; }
        .docs-section li { margin-bottom: 6px; }
        .docs-section code { font: 12px monospace; padding: 2px 6px; border-radius: 4px; background: var(--muted); border: 1px solid var(--border); }

        .docs-callout { padding: 16px 20px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); border-radius: 0 8px 8px 0; font: 13px monospace; color: var(--foreground); margin: 20px 0; }

        .docs-flow { display: flex; flex-direction: column; gap: 0; margin: 20px 0; border-left: 2px solid var(--accent); }
        .docs-flow-step { display: flex; align-items: flex-start; gap: 14px; padding: 16px 0 16px 20px; border-bottom: 1px solid var(--border); }
        .docs-flow-step:last-child { border-bottom: 0; }
        .docs-flow-num { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--accent-contrast); font: bold 11px monospace; flex-shrink: 0; }
        .docs-flow-step strong { font-size: 14px; display: block; margin-bottom: 2px; color: var(--foreground); }
        .docs-flow-step p { margin: 0; font: 12px monospace; color: var(--secondary); }

        :global(.api-method) { font: bold 10px monospace; padding: 3px 8px; border-radius: 4px; margin-right: 6px; }
        :global(.api-method.post) { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
        :global(.api-method.get) { background: color-mix(in srgb, #22c55e 15%, transparent); color: #22c55e; border: 1px solid color-mix(in srgb, #22c55e 30%, transparent); }

        :global(.code-block) { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin: 12px 0 20px; background: var(--charcoal); }
        :global(.code-block-header) { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
        :global(.code-copy-btn) { display: flex; align-items: center; gap: 4px; border: 0; background: transparent; cursor: pointer; font: 11px monospace; color: var(--secondary); transition: color .2s; }
        :global(.code-copy-btn:hover) { color: var(--accent); }
        :global(.code-block pre) { margin: 0; padding: 16px; overflow-x: auto; }
        :global(.code-block code) { font: 12px monospace; color: #e2e8f0; background: none; border: none; padding: 0; }

        @media (max-width: 600px) {
          .docs-page { padding: 20px; }
          .docs-tabs { flex-direction: column; }
        }
      `}</style>
    </div>
  )
}
