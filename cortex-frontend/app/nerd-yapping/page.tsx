'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Plus, X, Sun, Moon } from 'lucide-react'
import Link from 'next/link'

const faqs = [
  ['Which AIs support this cooked protocol?', 'Any MCP client: Claude Desktop and Claude Code, Cursor, Cline, Windsurf, Continue — and your own agent, since the core is plain REST over JSON. ChatGPT\u2019s consumer app cannot attach a local stdio MCP server, so for ChatGPT, Claude.ai and Gemini web you use the browser extension instead, consent-gated, at your own risk under their terms. We are not going to pretend otherwise.'],
  ['Can I export my memories?', 'Always. GET /v1/export hands you one JSON document with every node, edge, confidence score and provenance field, and each node already carries a cortex:// URI. That is close enough to JSON-LD to frame in about five lines, and we deliberately do not call it JSON-LD until the export emits an @context itself. No vendor lock-in bullshit, including from us.'],
  ['Do I need a database?', 'No. The default backend is a single JSON file at ~/.cortex/cortex-graph.json — readable with an editor, greppable, backable-up-able. SurrealDB and Qdrant are opt-in accelerators behind CORTEX_SURREAL_URL and CORTEX_QDRANT_URL, and the core logs which mode it actually got. If someone tells you graph memory requires a cluster, they are selling you the cluster.'],
  ['Why would I turn on Qdrant?', 'When your graph gets big enough that exact-label lookup stops being enough. Qdrant adds ANN search over node embeddings (needs an embedding key). Without it, recall runs on labels, predicates, edge traversal and recency — which is honestly fine up to tens of thousands of memories.'],
  ['How do you handle token limits?', 'We enforce them instead of praying. Every briefing is built against a token budget (default 600, clamped server-side by CORTEX_MAX_TOKEN_BUDGET), and when the budget cuts something off, the response says truncated: true rather than quietly dropping your context. The MCP tool refuses to pretend a 4,000-token dump is a 500-token budget.'],
  ['What if I want to turn off memory decay?', 'CORTEX_DECAY_POLICY=off and nothing fades; =soft (the default) only ranks stale memory down; =hard actually prunes it. Pin anything with cortex_lock and it survives every policy, including hard. But trust me, you say a lot of useless shit — let the curve do its job.'],
  ['Is there an API?', 'Yes, and it is not GraphQL: POST /v1/ingest, POST /v1/recall, /v1/flush, /v1/memories, /v1/stats, /v1/export, /v1/sweep, plus /ws for live graph events. Build whatever the fuck you want, and read the request schemas in cortex-core/src/api/server.rs because the docs are generated from the same structs, not from vibes.'],
  ['Who are you guys?', 'One person: Aryan Sharma. No incorporation, no funding, no team page to pad. That is either a red flag or the reason the roadmap is honest — your call, and the license says you can always fork it if I get weird.'],
]

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return <motion.div className={className} initial={{ opacity: 0, y: reduce ? 0 : 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>
}

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => { const saved = localStorage.getItem('cortex-theme'); const isDark = saved === 'dark'; setDark(isDark); document.documentElement.classList.toggle('dark', isDark) }, [])
  const toggle = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('cortex-theme', next ? 'dark' : 'light') }
  return <button className="icon-button" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
}

export default function NerdYapping() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  return <main>
    <header className="nav">
      <Link href="/" className="logo">Cortex<span>.</span></Link>
      <div className="nav-actions">
        <ThemeToggle />
        <Link href="/" className="button small ghost"><ArrowLeft size={15}/> Back to safety</Link>
      </div>
    </header>
    
    <section className="section faq wrap" style={{ paddingTop: '160px', minHeight: '80vh' }}>
      <Reveal>
        <p className="eyebrow">YAPPING ZONE / 404</p>
        <h2>More yapping for nerds</h2>
        <p className="lead">You asked for it. The deep lore on our tech stack, our protocol, and why we absolutely fucking hate bloated context windows.</p>
      </Reveal>
      
      <div className="faq-list" style={{ marginTop: '3rem' }}>
        {faqs.map(([q,a], i) => 
          <div className="faq-item" key={q}>
            <button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
              <span>{q}</span>
              {openFaq === i ? <X size={19}/> : <Plus size={19}/>}
            </button>
            <AnimatePresence initial={false}>
              {openFaq === i && 
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <p>{a}</p>
                </motion.div>
              }
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>

    <footer className="footer wrap">
      <div className="footer-watermark" aria-hidden="true"><span>NERD</span><b>.</b></div>
      <div className="footer-bottom"><span>© 2026 Cortex (Big Tech is still cooked)</span><span className="mono">GO BUILD SOME SHIT.</span><ThemeToggle /></div>
    </footer>
  </main>
}
