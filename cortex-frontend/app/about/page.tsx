import { ArrowLeft } from 'lucide-react'

export default function AboutPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small"><ArrowLeft size={15}/> Return to Protocol</a>
      </div>
      
      <p className="eyebrow">THE LORE / 01</p>
      <h1 style={{ fontSize: 'clamp(42px, 5vw, 70px)', letterSpacing: '-0.05em' }}>The Unhinged Origin.</h1>
      
      <div className="legal-content" style={{ marginTop: '4rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3rem' }}>
        
        <article style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 1rem', color: 'var(--accent)' }}>The Catalyst</h3>
          <p style={{ color: 'var(--secondary)' }}>We didn't build this to "change the world." We built it out of pure, unadulterated engineering rage. One day, after having to explain the exact same architectural context to an LLM for the 50th time in a week, we snapped.</p>
          <p style={{ color: 'var(--secondary)' }}>Big Tech insists the solution to AI amnesia is to just hand them more money for larger context windows. 128k tokens! 1 million tokens! It's a mathematical trap. You are paying linear token fees for exponential memory loss.</p>
        </article>

        <article style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 1rem', color: 'var(--accent)' }}>The Philosophy</h3>
          <p style={{ color: 'var(--secondary)' }}>AI models shouldn't hold memory. They should just compute. The memory should belong to YOU, locally, stored in a mathematical graph that never forgets. Cortex was built to decouple your neural state from corporate servers.</p>
        </article>

        <article style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 1rem', color: 'var(--accent)' }}>The License</h3>
          <p style={{ color: 'var(--secondary)' }}>We open-sourced this under the AGPLv3 license. That means you are free to take our code, run it yourself, and hack it to pieces. But if you try to wrap a proprietary API around it and sell it without open-sourcing your own changes, we will see you in court.</p>
        </article>
        
      </div>
    </main>
  )
}
