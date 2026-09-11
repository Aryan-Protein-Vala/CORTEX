import { ArrowLeft } from 'lucide-react'

export const metadata = {
  title: 'About',
  description: 'Why CORTEX exists, who is building it, and what is not finished yet.',
}

const card = {
  background: 'var(--surface)',
  padding: '2rem',
  borderRadius: '12px',
  border: '1px solid var(--border)',
} as const
const body = { color: 'var(--secondary)' } as const
const head = { margin: '0 0 1rem', color: 'var(--accent)' } as const

export default function AboutPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small">
          <ArrowLeft size={15} /> Return to Protocol
        </a>
      </div>

      <p className="eyebrow">THE LORE / 01</p>
      <h1 style={{ fontSize: 'clamp(42px, 5vw, 70px)', letterSpacing: '-0.05em' }}>
        The Unhinged Origin.
      </h1>

      <div
        className="legal-content"
        style={{
          marginTop: '4rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '3rem',
        }}
      >
        <article style={card}>
          <h3 style={head}>The Catalyst</h3>
          <p style={body}>
            I did not build this to &ldquo;change the world.&rdquo; I built it out of pure,
            unadulterated engineering rage: after explaining the exact same architectural context to
            an LLM for the fiftieth time in a week, I snapped. One person, one repo, no marketing
            department — which is also why the docs are blunt about what is not finished.
          </p>
          <p style={body}>
            The industry&rsquo;s answer to AI amnesia is to hand the labs more money for larger context
            windows. 128k tokens, then a million. It is a mathematical trap: you pay linear token fees
            for exponential memory loss, and the model still cannot tell you what depends on what.
          </p>
        </article>

        <article style={card}>
          <h3 style={head}>The Philosophy</h3>
          <p style={body}>
            Models should not hold memory. They should compute. Your state should live on your machine,
            in a graph you can open in a text editor — one that fades things on purpose, because a
            memory that never forgets is not a memory, it is a landfill.
          </p>
          <p style={body}>
            So: triplets with confidence and provenance, recall that spends a fixed token budget
            instead of vomiting context, decay as a scoring prior rather than a shredder, and no server
            of mine in the loop. If a better engine than mine ships tomorrow, you can export the graph
            and leave, which is the only lock-in policy I respect.
          </p>
        </article>

        <article style={card}>
          <h3 style={head}>The License</h3>
          <p style={body}>
            AGPL-3.0-or-later. Take the code, run it, hack it to pieces, sell services around it. The
            one condition: if you run a modified CORTEX as a network service for other people, you give
            them the source of your modifications, per the license&rsquo;s own terms.
          </p>
          <p style={body}>
            That is a licensing model, not a threat. If AGPL genuinely blocks a closed-source embedding
            of the SDKs, open an issue and ask — a dual license is on the table; pretending the clause
            does not apply is not.
          </p>
        </article>

        <article style={card}>
          <h3 style={head}>What is and is not done</h3>
          <p style={body}>
            Works today: the core (capture, extraction, decay, recall, HTTP + WebSocket, one JSON file,
            no infrastructure), the MCP server, the Chrome extension, the JS and Python SDKs, this
            dashboard reading your own core. Every one of those has a test suite you can run.
          </p>
          <p style={body}>
            Not built: mesh replication (the publish endpoint answers <code>501</code>), hosted CORTEX,
            accounts, billing (the pricing page says so out loud), app-store distribution, and a signed
            desktop installer. I would rather you find that out here than in an issue thread.
          </p>
          <p style={body}>
            The command list and the honesty policy are in the{' '}
            <a href="/docs" style={{ color: 'var(--accent)' }}>
              docs
            </a>{' '}
            and in <code>README.md</code>.
          </p>
        </article>
      </div>
    </main>
  )
}
