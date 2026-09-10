import { ArrowLeft } from 'lucide-react'

/**
 * These are the terms of an open-source project, not of a service: there is no
 * subscription, no SLA and nothing to refund. The copy still has the house voice,
 * but every factual claim below matches the code — including the parts that used
 * to promise a hosted product that was never built.
 */
export const metadata = {
  title: 'Terms',
  description: 'Terms for using CORTEX: an AGPL-licensed local-first memory engine. No service, no SLA, no bullshit.',
}

const Section = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => (
  <section>
    <h3>
      {n}. {title}
    </h3>
    {children}
  </section>
)

export default function TermsPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small">
          <ArrowLeft size={15} /> Back to home
        </a>
      </div>

      <p className="eyebrow">LEGAL SHIT / 01</p>
      <h1>Terms</h1>
      <p className="lead" style={{ maxWidth: 760, color: 'var(--secondary)' }}>
        Nobody is selling you anything on this page, which makes these the shortest honest terms you
        will read today.
      </p>

      <div
        className="legal-content"
        style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 800 }}
      >
        <Section n="1" title="What you are agreeing to">
          <p>
            You are downloading source code, not signing up for a service. There is no account, no
            uptime promise, no support window and no refund policy, because there is no transaction. If
            you use it, these terms apply; if that is a problem, close the tab and go back to paying
            linear token fees — it is really that simple.
          </p>
        </Section>

        <Section n="2" title="The license is the deal">
          <p>
            CORTEX is AGPL-3.0-or-later. Take the code, run it, fork it, sell consulting around it. The
            one obligation: if you run a modified CORTEX as a network service for other people, you
            offer them the source of your modifications. That clause is not a threat or a vibe — it is
            the whole licensing model, and it applies to the frontend, <code>cortex-js</code> and{' '}
            <code>cortex-py</code> too, so if AGPL blocks a legitimate integration in your stack, open
            an issue and ask for a dual license instead of quietly stripping the notice.
          </p>
        </Section>

        <Section n="3" title="Your conduct">
          <ul>
            <li>
              Do not build a CORTEX deployment that stores other people&rsquo;s memories without a lawful
              basis for it. The file on your disk is a controller&rsquo;s file.
            </li>
            <li>
              Do not use this to scrape, harvest or profile people. The capture primitives here are for
              your own conversations; the extension is consent-gated for exactly that reason, and turning
              it against someone else&rsquo;s traffic is out of scope and out of license-good-faith.
            </li>
            <li>
              Do not pretend we endorsed you. No affiliation with OpenAI, Google, Anthropic, Meta or
              anyone else mentioned on this site exists; their names and marks belong to them, and the
              marketing copy is opinion and hyperbole, not an insider claim about anyone&rsquo;s emotional
              state.
            </li>
          </ul>
        </Section>

        <Section n="4" title="Third-party surfaces, at your own risk">
          <p>
            The browser extension instruments ChatGPT, Claude and Gemini web apps. Those products&rsquo;
            consumer terms may prohibit that. You are the one deciding to click &ldquo;Allow for this
            site&rdquo;; the risk is yours, and the honest recommendation is the MCP route, where a client
            asks us for context instead of us watching a webpage.
          </p>
          <p>
            If you point the core at OpenRouter for extraction, that call is governed by their terms and
            your bill. Nothing here intercepts your payment methods or your provider keys.
          </p>
        </Section>

        <Section n="5" title="Data, decay and loss">
          <p>
            CORTEX is provided as is, with no warranty, to the maximum extent the law allows. It will
            score your memories down over time; by default that is a ranking change and not a deletion,
            and deletion of sub-threshold memories only happens if you set{' '}
            <code>CORTEX_DECAY_POLICY=hard</code>. Locked memories are never forgotten by the machine.
            If an algorithm drops something you cared about, that is a bad day, a bug report, and your
            backup&rsquo;s job — <code>GET /v1/export</code> exists so losing this repo costs you nothing.
          </p>
        </Section>

        <Section n="6" title="Liability">
          <p>
            No liability for lost data, lost money, hurt feelings, AI hallucinations, or anything
            incidental or consequential. This project receives no money from you, so there is no
            damage model here that would make sense anyway.
          </p>
        </Section>

        <Section n="7" title="Changes, and what is deliberately absent">
          <p>
            These terms can change; the website and the repository are the notice, since there is no
            email list to spam. There is no arbitration clause, no class-action waiver and no forum
            selection clause — not because they are unimportant, but because a solo project that has not
            incorporated should not pretend to have a legal department. If CORTEX ever charges money,
            this page gets replaced by something a lawyer wrote.
          </p>
        </Section>
      </div>
    </main>
  )
}
