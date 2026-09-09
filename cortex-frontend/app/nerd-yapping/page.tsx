'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Plus, X, Sun, Moon } from 'lucide-react'
import Link from 'next/link'

const faqs = [
  ['Which AIs support this cooked protocol?', 'All of them. ChatGPT, Claude, Gemini via our MCP. Because the protocol is open source, these mega-corps can’t lock you in anymore. Deal with it, Sam.'],
  ['Can I export my memories?', 'Always. Memories are exportable JSON-LD. We don’t do that vendor lock-in bullshit.'],
  ['Why SurrealDB?', 'Because relationships matter, bro. Relational databases are for boomers and document stores are for people who don\'t understand graph theory. We need to map nodes (you) to nodes (Python) with edges (simping) or the AI won\'t know shit.'],
  ['Why Qdrant?', 'Because it\'s written in Rust and it\'s blazingly fast. We need to do vector similarity searches to find context before the LLM starts hallucinating like a fucking idiot.'],
  ['How do you handle token limits?', 'We don\'t. We completely bypass that shit. We only inject the precise semantic triplets you need for the current thought. Your context window stays pristine.'],
  ['What if I want to turn off memory decay?', 'You can pin memories so they never decay. But trust me, you say a lot of useless shit. Let the biological algorithm do its goddamn job.'],
  ['Is there an API?', 'Obviously. We expose a REST API and an MCP server. Build whatever the fuck you want.'],
  ['Who are you guys?', 'Just some engineers who got so goddamn frustrated with the amnesia pandemic in AI that we built the fix ourselves. Stop asking questions and start building.']
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
