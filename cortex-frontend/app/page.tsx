'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, Menu, Moon, Network, Plus, Sun, X, Copy, Terminal, Upload, Sparkles, Zap } from 'lucide-react'

const queries = [
  { q: 'Help me code an API for the 50th time', a: "I'll scaffold the Python API since you never shut the fuck up about it.", note: 'Cortex remembered you are a Python simp ↗', path: ['User', 'Cries', 'Python', 'Simp', 'API'] },
  { q: 'How should I structure this app?', a: 'Are you fucking kidding me? I told you to use modular architecture 2 months ago. Wake up.', note: 'Cortex remembered your goldfish memory ↗', path: ['User', 'Goldfish', 'Memory', 'Needs', 'Help'] },
]
const crossQueries = [
  { q: 'Can you rewrite this React component?', a: 'Yeah. I see ChatGPT already set up Tailwind for this yesterday. I\'m not gonna ask you to repeat yourself like an idiot.', note: 'Claude read your ChatGPT context ↗', path: ['ChatGPT', 'Tailwind', 'Config', 'Claude', 'React'] },
  { q: 'Deploy this infrastructure.', a: 'Deploying to Vercel. Gemini noted you wanted Vercel for this specific repo 3 days ago. Don\'t worry, I won\'t put it on AWS.', note: 'OpenAI read your Gemini logs ↗', path: ['Gemini', 'Vercel', 'Preference', 'OpenAI', 'Deploy'] },
]
const faqs = [
  ['How is this different from ChatGPT’s memory?', 'ChatGPT is a fucking goldfish. Cortex is a model-agnostic Graph+Vector brain. It stores structured context so you don’t have to keep reminding these stupid AIs who you are every damn session.'],
  ['What the fuck is the Universal AI Protocol?', 'One namespace per brain, addressed as cortex://you, resolvable as JSON-LD by anything that can make an HTTP call — MCP, the extension, curl. Your ChatGPT context becomes readable by Claude because it is stored once, outside both of them. Cross-tool today; the official spec and mesh federation are still just a markdown file.'],
  ['Where is my data? Are you stealing my shit?', 'In a JSON file you can read, back up and grep — `~/.cortex/cortex-graph.json` by default. There is no CORTEX server in the loop, no account, and no telemetry in the MCP, SDKs or extension. A hosted plan is a plan, not this build: if you need someone else to run it, run the same binary on your own box.'],
  ['How does the biological memory decay work?', 'Ebbinghaus\'s forgetting curve (R = e^(-Δt/S)) decides what still earns a place in your context. Default policy is soft: dead weight stops being injected and stays recoverable. Set CORTEX_DECAY_POLICY=prune if you actually want it deleted, and anything you lock at impact 10 is exempt by construction.'],
]

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return <motion.div className={className} initial={{ opacity: 0, y: reduce ? 0 : 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>
}

function Graph({ active = 4, isLive = false, meshMode = false }: { active?: number; isLive?: boolean, meshMode?: boolean }) {
  const [activeNodes, setActiveNodes] = useState(active);
  
  useEffect(() => {
    if (!isLive || typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    try {
      // Explicit opt-in only: an https page cannot open ws://localhost, and a
      // socket that fails on every mount is noise rather than a feature.
      const wsUrl = process.env.NEXT_PUBLIC_CORTEX_WS_URL;
      if (!wsUrl) return;
      ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'WS_SYNAPSE_PULSE') {
            setActiveNodes(prev => Math.min(prev + 1, 8));
          } else if (data.type === 'WS_DECAY') {
            setActiveNodes(prev => Math.max(prev - 1, 0));
          }
        } catch {
          // Ignored
        }
      };

      ws.onerror = () => {
        // Silently handle offline Rust core
      };
    } catch {
      // Ignored
    }
    
    return () => {
      if (ws) ws.close();
    };
  }, [isLive]);

  const points = [[32,90],[100,45],[168,112],[240,46],[305,98],[370,38],[430,104],[492,55]];
  const edges = [[0,1],[1,2],[1,3],[2,3],[2,4],[3,5],[4,5],[4,6],[5,7],[6,7]];
  
  // Extra nodes/edges to simulate the vast global mesh when toggled on
  const meshPoints = [[60, 20], [140, 10], [220, 140], [280, 20], [350, 130], [420, 15], [480, 120]];
  const meshEdges = [[0,1], [2,4], [3,5], [4,6], [1,3], [0,2]];

  return <svg className="graph" viewBox="0 0 525 150" role="img" aria-label="Cortex memory graph visualization">
    {/* Global Mesh Layer */}
    <AnimatePresence>
      {meshMode && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}>
          {meshEdges.map(([a,b], i) => <path key={`mesh-e-${i}`} d={`M${meshPoints[a][0]} ${meshPoints[a][1]} L ${meshPoints[b][0]} ${meshPoints[b][1]}`} className="graph-path global-mesh" />)}
          {meshPoints.map(([x,y], i) => <circle key={`mesh-n-${i}`} cx={x} cy={y} r={3} className="graph-node global-mesh" />)}
        </motion.g>
      )}
    </AnimatePresence>
    
    {/* Local Graph Layer */}
    {edges.map(([a,b], i) => <path key={`e-${i}`} d={`M${points[a][0]} ${points[a][1]} Q ${(points[a][0]+points[b][0])/2} ${(points[a][1]+points[b][1])/2-25} ${points[b][0]} ${points[b][1]}`} className={i < activeNodes ? 'graph-path active' : 'graph-path'} style={{ animationDelay: `${i * 110}ms` }} />)}
    {points.map(([x,y], i) => <circle key={`n-${i}`} cx={x} cy={y} r={i < activeNodes ? 5 : 3} className={i < activeNodes ? 'graph-node active' : 'graph-node'} style={{ animationDelay: `${i * 140}ms` }} />)}
  </svg>
}

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => { const saved = localStorage.getItem('cortex-theme'); const isDark = saved === 'dark'; setDark(isDark); document.documentElement.classList.toggle('dark', isDark) }, [])
  const toggle = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('cortex-theme', next ? 'dark' : 'light') }
  return <button className="icon-button" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
}

export default function Page() {
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState(0)
  const [annual, setAnnual] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [hoverBar, setHoverBar] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState<0 | 1>(0)
  const [meshEnabled, setMeshEnabled] = useState(false)
  const [activeTab, setActiveTab] = useState<'mcp' | 'extension' | 'sdk'>('mcp')
  const [copiedMcp, setCopiedMcp] = useState(false)
  // The path has to be real: `args` is read by the IDE process, not the browser,
  // so pointing it at this site's origin (as the first version did) produced a
  // config that could never start.
  const [mcpPath, setMcpPath] = useState('/absolute/path/to/CORTEX/cortex-mcp/index.js')
  const [hydrating, setHydrating] = useState(false)
  const [hydrationStatus, setHydrationStatus] = useState<string | null>(null)

  const mcpSnippet = JSON.stringify({
    mcpServers: {
      cortex: {
        command: 'node',
        args: [mcpPath],
        env: { CORTEX_API_URL: 'http://localhost:3030' },
      },
    },
  }, null, 2)

  const copyMcpConfig = () => {
    navigator.clipboard.writeText(mcpSnippet);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  };

  const handleHydrateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHydrating(true);
    setHydrationStatus("Reading conversations.json...");

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setHydrationStatus("❌ Error: Uploaded file must be an OpenAI conversations array.");
        setHydrating(false);
        return;
      }

      setHydrationStatus(`Reading ${parsed.length} conversation(s); extracting durable facts takes one model call each, so this can run for a while...`);
      const res = await fetch('/api/hydrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversations: parsed, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setHydrationStatus(`Queued ${data.queued}/${parsed.length} conversation(s) · ${data.skipped ?? 0} skipped · ${data.failed ?? 0} failed. Open the dashboard: facts land as jobs finish.`);
      } else if (res.ok) {
        setHydrationStatus(`Nothing queued — ${data.message || 'no durable turns were found'}`);
      } else {
        setHydrationStatus(`Not hydrated: ${data.error || 'the hydrator endpoint rejected the upload'}`);
      }
    } catch {
      setHydrationStatus("❌ Error: Invalid JSON file format.");
    } finally {
      setHydrating(false);
    }
  };

  return <main>
    <header className="nav"><a href="#top" className="logo">Cortex<span>.</span></a><nav className="nav-links"><Link href="/dashboard" style={{ color: '#ea580c', fontWeight: 'bold' }}>Brain Dashboard</Link><a href="#how">How it works</a><a href="#specs">Specs</a><a href="#pricing">Pricing</a><a href="https://github.com/Aryan-Protein-Vala/CORTEX" target="_blank" rel="noreferrer">GitHub</a></nav><div className="nav-actions"><ThemeToggle /><Link href="/dashboard" className="button small" style={{ background: '#ea580c', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Zap size={14}/> Live Brain</Link><button className="menu-button" onClick={() => setMenu(!menu)} aria-label="Toggle menu">{menu ? <X/> : <Menu/>}</button></div></header>
    <AnimatePresence>{menu && <motion.div className="mobile-menu" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}><Link href="/dashboard" onClick={() => setMenu(false)}>Brain Dashboard</Link><a href="#how" onClick={() => setMenu(false)}>How it works</a><a href="#specs" onClick={() => setMenu(false)}>Specs</a><a href="#pricing" onClick={() => setMenu(false)}>Pricing</a><a href="#faq" onClick={() => setMenu(false)}>FAQ</a></motion.div>}</AnimatePresence>
    <section id="top" className="hero wrap"><div className="hero-copy"><p className="eyebrow">MEMORY INFRASTRUCTURE / 01</p><h1>AI is fucking stupid.<br/><em>We fixed it.</em></h1><p className="hero-sub">I was so goddamn frustrated with AI amnesia that I built this. Stop paying out the ass for massive context windows that hallucinate anyway. Give every AI model a single Hive Mind brain that remembers your shit permanently.</p><div className="hero-actions"><Link className="button" href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>Launch Neural Brain <Zap size={17}/></Link><a className="button ghost" href="#demo">See this shit work <ArrowRight size={17}/></a></div><p className="micro">Open protocol · Rust core · Built out of pure rage</p></div><div className="hero-visual"><div className="visual-label"><Network size={15}/> HIVE MIND GRAPH · SCHEMATIC <span>●</span></div><Graph active={7} isLive={true} meshMode={meshEnabled}/><div className="visual-caption"><span>your context window</span><strong>RIP</strong><small>memory lives here instead — persistent, local, yours</small></div></div></section>
    <section className="section muted"><div className="wrap"><Reveal><p className="eyebrow">THE BULLSHIT / 02</p><h2>AI has severe <em>fucking amnesia.</em></h2><p className="lead">You keep dumping massive text into context windows, burning GPU memory like a complete clown, and the AI STILL forgets who the fuck you are.</p></Reveal><div className="pain-grid">{[['01','ChatGPT is delusional','You shouldn’t have to re-introduce your entire fucking life every single day.'],['02','Claude’s window closes','Your good ideas vanish into the void and your token fees skyrocket.'],['03','Big Tech is scamming you','They want you paying for bloated context windows. Wake the fuck up.']].map(([n,t,d]) => <Reveal key={n}><article className="pain-card"><span className="card-num">{n}</span><div className="reset-icon"><Network size={21}/></div><h3>{t}</h3><p>{d}</p></article></Reveal>)}</div><div className="stat"><strong>♾️<span>$</span></strong><p>wasted on token fees<br/><span>for absolute garbage</span></p></div></div></section>
    <section className="section protocol-section"><div className="wrap"><Reveal><p className="eyebrow">THE BS SILOS / 02.5</p><h2>Every AI is locked in<br/><em>a stupid fucking silo.</em></h2><p className="lead">ChatGPT can&apos;t read Claude&apos;s context. Gemini is just sitting there confused as shit. We fixed this mess with a single Universal Protocol.</p></Reveal><div className="pain-grid">{[['01','Graph First, Vectors Optional','Triplets in a graph you can open in an editor. SurrealDB and Qdrant are opt-in accelerators behind one env var each — the default is a single JSON file, no Docker.'],['02','Decay Is a Score','Retention follows an Ebbinghaus-shaped curve, so stale memory ranks itself out of your briefings. Fading is the default; deletion is an env var you have to choose.'],['03','Your State, Your Box','Context doesn’t die at the API: it is served from localhost in single-digit milliseconds. Peer-to-peer mesh sharing is designed and not shipped — the endpoint says 501.']].map(([n,t,d]) => <Reveal key={n}><article className="pain-card"><span className="card-num">{n}</span><div className="reset-icon"><Network size={21}/></div><h3>{t}</h3><p>{d}</p></article></Reveal>)}</div><div className="stat"><strong>0<span>¢</span></strong><p>spent on retrieval per prompt — recall is a local graph walk against a fixed token budget<br/><span>the model still bills what it bills</span></p></div></div></section>
    <section id="how" className="section wrap"><Reveal><p className="eyebrow">THE TECH / 03</p><h2>From brain-dead AI<br/>to <em>Un-lobotomized memory.</em></h2></Reveal><div className="timeline">{[['Intercept','Your own turns are captured — from the editor over MCP, or from the browser after you click Allow. Nothing is harvested before consent.'],['Graph It','Each turn becomes (subject → predicate → object) triplets with confidence, provenance and an impact score. SurrealDB is opt-in; the default is a file.'],['Score It','Ranking fuses semantic similarity, edge traversal, impact and recency. Qdrant accelerates the vector step when you point at one, and recall works fine without it.'],['Fade the Junk','An Ebbinghaus curve pushes stale memory out of your briefings. It is a score, not a shredder: hard deletion and locked-immunity are explicit choices.'],['Inject a Briefing','A graph walk, then a token-budgeted brief the model can actually use — the budget is clamped server-side, so &ldquo;context rot&rdquo; cannot come back through our door.']].map(([t,d], i) => <Reveal key={t}><div className="step"><div className="step-marker">0{i+1}</div><div><p className="mono">{['CAPTURE','GRAPH','SCORE','FADE','INJECT'][i]}</p><h3>{t}</h3><p>{d}</p></div><div className="step-art"><Graph active={i + 2}/></div></div></Reveal>)}</div></section>
    <section id="demo" className="section demo-section"><div className="wrap"><Reveal><p className="eyebrow">SEE IT IN ACTION / 04</p><h2>Memory that <em>doesn't suck.</em></h2><div className="demo-toggle" role="group" aria-label="Demo mode"><span>Show:</span><button className={demoMode === 0 ? 'selected' : ''} onClick={() => {setDemoMode(0); setQuery(0);}}>Un-lobotomized Recall</button><button className={demoMode === 1 ? 'selected' : ''} onClick={() => {setDemoMode(1); setQuery(0);}}>Cross-AI Sorcery</button></div></Reveal><div className="demo-grid"><div className="chat-box"><div className="box-top"><span><i/> cortex.session</span><span className="mono">SCRIPTED DEMO</span></div><div className="chat-body"><p className="chat-label">YOU</p><div className="bubble user">{(demoMode === 0 ? queries : crossQueries)[query].q}</div><p className="chat-label">CORTEX AI</p><div className="bubble ai">{(demoMode === 0 ? queries : crossQueries)[query].a}</div><p className="annotation">↗ {(demoMode === 0 ? queries : crossQueries)[query].note}</p></div><button className="try-button" onClick={() => setQuery((query + 1) % (demoMode === 0 ? queries : crossQueries).length)}>Try another query bro <ArrowRight size={15}/></button></div><div className="demo-graph"><div className="box-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>HIVE MIND</span><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><label className="mono" style={{ fontSize: '10px', cursor: 'pointer' }} title="Peer-to-peer mesh sharing is designed, not shipped: /v1/mesh/publish returns 501.">MESH · CONCEPT ONLY</label><input type="checkbox" checked={meshEnabled} onChange={e => setMeshEnabled(e.target.checked)} /></div></div><Graph active={query ? 8 : 6} isLive={true} meshMode={meshEnabled}/><div className="path-tags">{(demoMode === 0 ? queries : crossQueries)[query].path.map((p, i) => <span key={p} className="path-tag">{p}{i < 4 && <ArrowRight size={12}/>}</span>)}</div><p className="mono graph-foot">illustrative path · your real graph and numbers are in the dashboard</p></div></div></div></section>
    <section id="specs" className="section wrap"><Reveal><p className="eyebrow">UNDER THE HOOD / 05</p><h2>Built to <em>fuck up the industry.</em></h2></Reveal><div className="spec-grid">{[['PERFORMANCE','file-first','One JSON file, no services required: a localhost read is sub-millisecond, and Surreal or Qdrant are opt-in upgrades.'],['BUDGET','bounded','Recall packs a token budget, not your whole history — the ceiling is enforced in code, not promised in a slide.'],['BRAIN','triples','Subject-predicate-object edges with impact scores, so a correction reroutes the graph instead of appending a paragraph.'],['DECAY','Ebbinghaus','R = e^(-Δt/S) decides what still gets injected. Soft by default: fading is not deletion.'],['OUTPUT','JSON-LD','One namespace readable by the MCP, the extension, an SDK call or curl — same ids, same rules.']].map(([label,value,desc]) => <div className="spec" key={label}><p className="mono">{label}</p><strong>{value}</strong><p>{desc}</p><div className="spec-line"/></div>)}</div></section>

    {/* Quick Start & Integration Section */}
    <section id="install" className="section wrap" style={{ paddingTop: '80px', paddingBottom: '80px' }}>
      <Reveal>
        <p className="eyebrow">DEPLOY / 05.5</p>
        <h2>Connect your tools in <em>60 seconds.</em></h2>
        <p className="lead">Integrate Cortex with Cursor, Claude Desktop, your browser, or your custom agents right now.</p>
      </Reveal>

      <div style={{ marginTop: '40px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '30px' }}>
        <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '24px' }}>
          <button 
            className={`button small ${activeTab === 'mcp' ? '' : 'ghost'}`} 
            onClick={() => setActiveTab('mcp')}
          >
            <Terminal size={14}/> Cursor / Claude MCP
          </button>
          <button 
            className={`button small ${activeTab === 'extension' ? '' : 'ghost'}`} 
            onClick={() => setActiveTab('extension')}
          >
            <Network size={14}/> Chrome Extension
          </button>
          <button 
            className={`button small ${activeTab === 'sdk' ? '' : 'ghost'}`} 
            onClick={() => setActiveTab('sdk')}
          >
            <Sparkles size={14}/> TypeScript & Python SDKs
          </button>
        </div>

        {activeTab === 'mcp' && (
          <div>
            <p style={{ color: 'var(--secondary)', marginBottom: '14px', fontSize: '14px' }}>
              Add this to your Cursor (<code>.cursor/mcp.json</code>) or Claude Desktop (<code>claude_desktop_config.json</code>) to give your IDE permanent memory.
              Run <code>./setup-cursor-mcp.sh</code> in the repo to have it merged in for you — it never overwrites an existing config, it writes <code>.cursor/mcp.json.cortex-backup</code> first.
            </p>
            <p style={{ color: 'var(--secondary)', margin: '-6px 0 14px', fontSize: 13 }}>
              Do not run <code>npx -y cortex-mcp</code>: that npm name belongs to an unrelated package and is not this project.
              Build the server from this repo (<code>cd cortex-mcp &amp;&amp; npm install</code>), then point <code>args</code> at <code>index.js</code> above.
            </p>
            <div style={{ position: 'relative', background: 'var(--muted)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: '13px', overflowX: 'auto' }}>
              <label className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--secondary)', marginBottom: 6 }}>
                ABSOLUTE PATH TO cortex-mcp/index.js (what your IDE will actually run)
              </label>
              <input
                className="field"
                value={mcpPath}
                onChange={(e) => setMcpPath(e.target.value)}
                spellCheck={false}
                style={{ marginBottom: 12, fontSize: 12 }}
                aria-label="Absolute path to the CORTEX MCP entrypoint"
              />
              <pre>{mcpSnippet}</pre>
              <button 
                onClick={copyMcpConfig}
                className="button small ghost" 
                style={{ position: 'absolute', top: '12px', right: '12px', background: 'var(--surface)' }}
              >
                {copiedMcp ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy JSON</>}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'extension' && (
          <div>
            <p style={{ color: 'var(--secondary)', marginBottom: '14px', fontSize: '14px' }}>
              Inject Cortex directly into ChatGPT and Claude on the web:
            </p>
            <ol style={{ color: 'var(--secondary)', paddingLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
              <li>Open Chrome and navigate to <code>chrome://extensions</code></li>
              <li>Toggle <strong>Developer mode</strong> in the top right corner</li>
              <li>Click <strong>Load unpacked</strong> and select the <code>cortex-extension</code> directory in this repo</li>
              <li>Start the core (<code>cd cortex-core &amp;&amp; cargo run --release --bin cortex-core</code>) — the extension talks to your own core at <code>http://127.0.0.1:3030</code>, never to us.</li>
              <li>Open a chat and accept the consent card. Until you do, nothing is read. The toolbar icon pauses it, shows what was stored, and lets you forget any memory.</li>
            </ol>
          </div>
        )}

        {activeTab === 'sdk' && (
          <div>
            <p style={{ color: 'var(--secondary)', marginBottom: '14px', fontSize: '14px' }}>
              Inject the Hive Mind directly into your autonomous agents and backend services:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ background: 'var(--muted)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p className="mono" style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>TypeScript / Node.js</p>
                <code style={{ display: 'block', marginBottom: '10px', fontSize: '13px' }}>npm install file:../cortex-js</code>
                <pre style={{ fontSize: '11px', color: 'var(--secondary)' }}>{`import { Cortex } from 'cortex-js'
const c = new Cortex({ url: 'http://127.0.0.1:3030', apiKey: process.env.CORTEX_API_KEY })
await c.remember('always use pnpm in CI', { owner: 'cortex://default' })
const { briefing } = await c.recall('which package manager?', { owner: 'cortex://default' })`}</pre>
                <p style={{ fontSize: 11, color: 'var(--secondary)', margin: '8px 0 0' }}>
                  Published as <code>@cortex-js/sdk</code> once the registry name is claimed; until then install from the repo. The bare name <code>cortex-js</code> is available and not yet ours.
                </p>
              </div>
              <div style={{ background: 'var(--muted)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p className="mono" style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>Python</p>
                <code style={{ display: 'block', marginBottom: '10px', fontSize: '13px' }}>pip install -e ./cortex-py</code>
                <pre style={{ fontSize: '11px', color: 'var(--secondary)' }}>{`from cortex_py import Cortex

c = Cortex(url="http://127.0.0.1:3030", api_key=os.environ["CORTEX_API_KEY"])
c.remember("ship from main only behind a feature flag")
print(c.recall("what is our branching rule?").briefing)`}</pre>
                <p style={{ fontSize: 11, color: 'var(--secondary)', margin: '8px 0 0' }}>
                  Never <code>pip install cortex-sdk</code> — that PyPI name is a different project by someone else.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>

    {/* Retroactive Memory Hydration Upload Section */}
    <section id="hydrate" className="section muted" style={{ paddingTop: '80px', paddingBottom: '80px' }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">HYDRATE / 05.8</p>
          <h2>Retroactive <em>Memory Ingestion.</em></h2>
          <p className="lead">Got years of ChatGPT history? Export your data from OpenAI and upload <code>conversations.json</code> to instantly construct your memory graph.</p>
        </Reveal>

        <div style={{ marginTop: '40px', background: 'var(--surface)', border: '2px dashed var(--border)', borderRadius: '12px', padding: '40px 20px', textAlign: 'center' }}>
          <Upload size={36} style={{ color: 'var(--accent)', margin: '0 auto 16px' }}/>
          <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Upload conversations.json</h3>
          <p style={{ color: 'var(--secondary)', fontSize: '14px', marginBottom: '24px' }}>Select your unzipped OpenAI data export to hydrate the Hive Mind</p>
          
          <label className="button" style={{ cursor: 'pointer', display: 'inline-flex' }}>
            <Upload size={16}/> {hydrating ? 'Processing...' : 'Select File'}
            <input 
              type="file" 
              accept=".json" 
              onChange={handleHydrateUpload} 
              disabled={hydrating} 
              style={{ display: 'none' }}
            />
          </label>

          {hydrationStatus && (
            <p style={{ marginTop: '20px', fontWeight: 600, fontSize: '14px', color: hydrationStatus.includes('Error') || hydrationStatus.includes('❌') ? 'red' : 'var(--accent)' }}>
              {hydrationStatus}
            </p>
          )}
        </div>
      </div>
    </section>

    <section className="section muted proof"><div className="wrap"><Reveal><p className="eyebrow">THE THREAT / 06.5</p><h2>We are starving their<br/><em>revenue models.</em></h2><p className="lead" style={{marginBottom: '25px', marginTop: '15px'}}>When millions of you use Cortex, you aren't increasing their compute. You are doing the exact opposite. You are absolutely destroying their profit margins.</p><p style={{color: 'var(--secondary)', marginBottom: '40px', maxWidth: '800px', lineHeight: '1.6'}}>OpenAI, Anthropic, and Google make billions by charging you to re-read your own fucking chat history on every single turn. By keeping memory client-side, the re-sent history disappears from your requests — and with it the part of the bill that was never about intelligence. Nobody has measured this for you; open the dashboard and watch your own input tokens stop climbing. Use Cortex so much that Sam Altman is forced to either adopt this protocol or try to buy us out.</p></Reveal><div className="metrics"><div><strong>flat</strong><span>Your cost per turn, as context stops growing (the chart above is a model of re-sending history, not a benchmark)</span></div><div><strong>±0</strong><span>Tokens sent to the model for memory you already have</span></div><div><strong>0</strong><span>Fucks Given</span></div></div><p className="trust">Works with the memory APIs of: <span>OpenAI</span><span>Anthropic</span><span>Google</span><span>anything that speaks MCP</span></p></div></section>
    <section className="section wrap"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '5vw', alignItems: 'center' }}><Reveal><p className="eyebrow">THE MATH / 06</p><h2>The more you yap,<br/><em>the more you save.</em></h2><p className="lead" style={{marginBottom: '20px'}}>Right now, if you talk to ChatGPT 100 times, you pay them to re-read the first 99 messages on the 100th turn. It's an absolute scam designed to milk your wallet.</p><p style={{color: 'var(--secondary)'}}>Cortex just remembers the important stuff. We only feed the AI exactly what it needs to know. Your bill stays flat. Theirs goes vertical.</p></Reveal><Reveal><div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '28px 28px 20px' }}><svg viewBox="0 0 460 300" style={{ width: '100%', height: 'auto', display: 'block' }}><line x1="60" y1="20" x2="60" y2="240" stroke="var(--border)" strokeWidth="1.5"/><line x1="60" y1="240" x2="440" y2="240" stroke="var(--border)" strokeWidth="1.5"/><text x="8" y="45" fill="var(--secondary)" fontSize="9" fontFamily="monospace">$125</text><text x="15" y="100" fill="var(--secondary)" fontSize="9" fontFamily="monospace">$50</text><text x="15" y="155" fill="var(--secondary)" fontSize="9" fontFamily="monospace">$15</text><text x="18" y="210" fill="var(--secondary)" fontSize="9" fontFamily="monospace">$3</text><text x="0" y="15" fill="var(--secondary)" fontSize="8" fontFamily="monospace">YOUR $$$</text>{[{x: 85, gh: 15, oh: 12, label: '10', gv: '$0.12', ov: '$0.10'}, {x: 185, gh: 55, oh: 8, label: '50', gv: '$3.40', ov: '$0.05'}, {x: 285, gh: 130, oh: 5, label: '100', gv: '$14.50', ov: '$0.03'}, {x: 385, gh: 210, oh: 3, label: '500', gv: '$125+', ov: '$0.02'}].map(b => <g key={b.label}><rect x={b.x} y={240 - b.gh} width="30" height={b.gh} rx="3" fill="var(--border)" opacity={hoverBar === `g${b.label}` ? 1 : 0.8} style={{cursor: 'pointer', transition: 'opacity .2s'}} onMouseEnter={() => setHoverBar(`g${b.label}`)} onMouseLeave={() => setHoverBar(null)}/>{hoverBar === `g${b.label}` && <><rect x={b.x - 12} y={240 - b.gh - 24} width="54" height="20" rx="4" fill="var(--foreground)"/><text x={b.x + 15} y={240 - b.gh - 10} fill="var(--background)" fontSize="10" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{b.gv}</text></>}<rect x={b.x + 35} y={240 - b.oh} width="30" height={b.oh} rx="3" fill="var(--accent)" opacity={hoverBar === `o${b.label}` ? 1 : 0.85} style={{cursor: 'pointer', transition: 'opacity .2s'}} onMouseEnter={() => setHoverBar(`o${b.label}`)} onMouseLeave={() => setHoverBar(null)}/>{hoverBar === `o${b.label}` && <><rect x={b.x + 23} y={240 - b.oh - 24} width="54" height="20" rx="4" fill="var(--accent)"/><text x={b.x + 50} y={240 - b.oh - 10} fill="var(--accent-contrast)" fontSize="10" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{b.ov}</text></>}</g>)}<text x="93" y="256" fill="var(--secondary)" fontSize="10" fontFamily="monospace" textAnchor="middle">10</text><text x="198" y="256" fill="var(--secondary)" fontSize="10" fontFamily="monospace" textAnchor="middle">50</text><text x="298" y="256" fill="var(--secondary)" fontSize="10" fontFamily="monospace" textAnchor="middle">100</text><text x="398" y="256" fill="var(--secondary)" fontSize="10" fontFamily="monospace" textAnchor="middle">500</text><text x="250" y="275" fill="var(--secondary)" fontSize="9" fontFamily="monospace" textAnchor="middle">CONVERSATIONS →</text><rect x="100" y="288" width="10" height="10" rx="2" fill="var(--border)" opacity="0.8"/><text x="115" y="297" fill="var(--secondary)" fontSize="9" fontFamily="monospace">Without Cortex (pain)</text><rect x="270" y="288" width="10" height="10" rx="2" fill="var(--accent)"/><text x="285" y="297" fill="var(--accent)" fontSize="9" fontWeight="bold" fontFamily="monospace">With Cortex (vibes)</text></svg></div></Reveal></div></section>
    <section id="pricing" className="section wrap"><div className="pricing-head"><Reveal><p className="eyebrow">ACCESS / 07</p><h2>Stop being a <em>clown.</em></h2>
        <p className="lead" style={{ margin: '10px 0 0', fontSize: 14 }}>Self-hosting is free forever and is the whole product today. Paid tiers are a promise about support, not a gate on your memory.</p></Reveal><div className="billing"><button className={!annual ? 'selected' : ''} onClick={() => setAnnual(false)}>Monthly</button><button className={annual ? 'selected' : ''} onClick={() => setAnnual(true)}>Annual <span>Save bigly</span></button></div></div><div className="pricing-grid">{[
      { name: 'Broke', price: '$0', desc: 'For peasants', features: ['The whole repo, self-hosted', 'File-backed graph + MCP + extension', 'Your own keys, your own machine'] },
      { name: 'Tryhard', price: annual ? '$69/yr' : '$8/mo', desc: 'For the elite devs', features: ['Hosted core — not shipped, this tier is a pre-order', 'Priority model routing for extraction (once hosted exists)', 'Help when a site changes its markup'] },
      { name: 'Whale', price: 'Custom', desc: 'For terrified platforms', features: ['License negotiation, incl. relicense off AGPL', 'On-prem, VPC, air-gapped', 'White-glove integration'] }
    ].map((plan, i) => <article className={`price-card ${i === 1 ? 'featured' : ''}`} key={plan.name}>{i === 1 && <span className="popular">NOTHING TO PAY TODAY</span>}<p className="mono">{plan.name.toUpperCase()}</p><h3>{plan.price}</h3><p>{plan.desc}</p><ul>{plan.features.map(f => <li key={f}><Check size={16}/>{f}</li>)}</ul>
            {i === 1 ? <p className="micro" style={{ margin: '-14px 0 12px', fontSize: 11 }}>Pre-order pricing: billing is not wired yet, so nothing is charged and nothing is promised beyond what the repo runs today.</p> : null}<Link href={i === 2 ? '/contact' : i === 1 ? '/dashboard' : '/dashboard/docs'} className={`button ${i === 1 ? '' : 'ghost'}`}>{i === 2 ? 'Talk to us' : i === 1 ? 'Stop Touching Grass' : 'Run it yourself'} <ArrowRight size={16}/></Link></article>)}</div></section>
    <section id="faq" className="section faq wrap"><Reveal><p className="eyebrow">FAQ / 08</p><h2>Cope &amp; Seethe</h2></Reveal><div className="faq-list">{faqs.map(([q,a], i) => <div className="faq-item" key={q}><button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}><span>{q}</span>{openFaq === i ? <X size={19}/> : <Plus size={19}/>}</button><AnimatePresence initial={false}>{openFaq === i && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}><p>{a}</p></motion.div>}</AnimatePresence></div>)}<div style={{marginTop: '2rem', textAlign: 'center'}}><a href="/nerd-yapping" className="button ghost">More yapping for nerds <ArrowRight size={17}/></a></div></div></section>
    <section className="cta"><div><p className="eyebrow">FINAL WARNING</p><h2>Stop burning tokens on this shit.<br/>Get a real brain.</h2><p>Start the core, point one tool at it, and never re-explain your stack again.</p><Link href="/dashboard/docs" className="button light">Read the docs first <ArrowRight size={17}/></Link></div></section>
    <footer className="footer wrap"><div className="footer-watermark" aria-hidden="true"><span>CORTEX</span><b>.</b></div><div className="footer-top"><a className="logo" href="#top">Cortex<span>.</span></a><div className="footer-links"><div><p>PRODUCT</p><a href="#how">Manifesto</a><a href="#pricing">Pricing</a><a href="https://github.com/Aryan-Protein-Vala/CORTEX">Changelog</a></div><div><p>COMPANY</p><a href="/about">Based About</a><a href="/legal/terms">Terms of Service</a><a href="/legal/privacy">Privacy Policy</a></div><div><p>COMMUNITY</p><a href="https://github.com/Aryan-Protein-Vala/CORTEX" target="_blank" rel="noreferrer">GitHub</a><a href="/contact">Contact Us</a></div></div></div><div className="footer-bottom"><span>© 2026 Cortex (Big Tech is cooked)</span><span className="mono">MEMORY, PERMANENTLY.</span><ThemeToggle /></div></footer>
  </main>
}
