import { ArrowLeft } from 'lucide-react'

/**
 * A privacy policy that describes a hosted product which does not exist is worse
 * than no policy. Everything below is checked against the code in this repo:
 * the core's env surface, the extension's permissions, the extractor, the
 * contact route and the analytics gate in `app/layout.tsx`.
 */
export const metadata = {
  title: 'Privacy',
  description:
    'What CORTEX collects: nothing by default, and exactly what it is when you turn a feature on.',
}

const Section = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => (
  <section>
    <h3>
      {n}. {title}
    </h3>
    {children}
  </section>
)

export default function PrivacyPage() {
  return (
    <main className="wrap section" style={{ paddingTop: '8rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" className="button ghost small">
          <ArrowLeft size={15} /> Back to home
        </a>
      </div>

      <p className="eyebrow">LEGAL SHIT / 02</p>
      <h1>Privacy Policy</h1>
      <p className="lead" style={{ maxWidth: 760, color: 'var(--secondary)' }}>
        Short version: the software stores memory on your machine and sends it nowhere. This page
        is long only because a privacy policy is worth reading when it names the three places data
        can actually move.
      </p>

      <div
        className="legal-content"
        style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 800 }}
      >
        <Section n="1" title="The product collects nothing">
          <p>
            CORTEX is a binary you run. Your memory graph is one file —{' '}
            <code>~/.cortex/cortex-graph.json</code> by default, moved with{' '}
            <code>CORTEX_DATA_DIR</code>. You can read it, grep it, back it up on a USB stick and
            burn it. The core, the MCP server, the SDKs and the extension contain no analytics, no
            crash reporting, no update ping and no account system, because no account system has
            been built. Any site claiming to sell you a CORTEX account is not us.
          </p>
          <p>
            The core listens on <code>127.0.0.1</code> and refuses to bind elsewhere unless you set{' '}
            <code>CORTEX_API_KEY</code> — the default is not &ldquo;secure enough for now&rdquo;, it is
            &ldquo;not exposed at all&rdquo;.
          </p>
        </Section>

        <Section n="2" title="The three ways bytes can leave your machine">
          <ul>
            <li>
              <strong>Extraction.</strong> Without <code>OPENROUTER_API_KEY</code> the &ldquo;Shadow
              Kernel&rdquo; is an offline heuristic and nothing is transmitted. With a key, the turns you
              ingest are sent to OpenRouter to be turned into triplets; they do not train their models
              or ours (we are not building a model) and their provider policy applies to that call.
            </li>
            <li>
              <strong>The browser extension.</strong> It does nothing until you click{' '}
              <em>Allow for this site</em> on its consent card, and even then it only keeps your own
              messages in memory for the tab. Nothing is sent anywhere until you type a core URL into
              its popup — that URL defaults to your own machine. The optional request-rewrite mode is
              off by default; when you turn it on it appends text to what you were already about to
              send, in the composer, where you can read it before it goes. It never invents a message
              and never edits anything but the text part of a message.
            </li>
            <li>
              <strong>The mesh.</strong> Sharing memory with other people is disabled in code: publishing
              returns <code>501</code> unless you both flip{' '}
              <code>CORTEX_ALLOW_MESH_PUBLISH=1</code> and point <code>CORTEX_MESH_PATH</code> at a file.
              There is no CORTEX server for it to talk to.
            </li>
          </ul>
        </Section>

        <Section n="3" title="Your AI provider&rsquo;s terms are your problem (honestly)">
          <p>
            The extension reads pages inside ChatGPT, Claude and Gemini. Automating or instrumenting
            those web apps can violate their consumer terms, and that risk sits with you, not with a
            project that has no money to hire a lawyer. The MCP path — where the client explicitly asks
            us for context — has no such problem. If you want zero ambiguity, use MCP and skip the
            extension.
          </p>
        </Section>

        <Section n="4" title="This website">
          <p>
            The marketing site sets no cookies and loads no ad or tracking scripts. The dashboard
            toggle for dark mode lives in <code>localStorage</code> on your own machine; that is the
            entire storage story.
          </p>
          <p>
            Pageview analytics (Vercel Analytics) is <strong>off</strong> unless the deployment sets{' '}
            <code>NEXT_PUBLIC_SITE_ANALYTICS=1</code>. On a deployment where it is on, that script
            reports page paths, referrer and a country derived from your IP hash. It is not on by
            default, and this sentence is how you can check: the code that renders it is{' '}
            <code>components/analytics.tsx</code>, and it is never imported when the flag is off.
          </p>
          <p>
            The contact form on this site does not go to an email provider or a CRM. It is appended to
            a JSON lines file on whatever machine serves the site (<code>CORTEX_CONTACT_FILE</code>) so
            a solo maintainer can read it without a third party in the middle. Want it gone? Open an
            issue on GitHub asking and it is deleted — the file is one grep away.
          </p>
        </Section>

        <Section n="5" title="Forgetting, deletion and export">
          <p>
            Memory decay in CORTEX is a scoring function, not a shredder. At the default policy
            (<code>CORTEX_DECAY_POLICY=soft</code>) an old memory is flagged faded and ranked out of
            your briefings but stays in the file. Only if you explicitly set
            <code>CORTEX_DECAY_POLICY=prune</code> are memories below the retention floor of 0.05
            deleted, and locked memories are never removed under any policy. Forgetting is meant to be reversible unless you chose otherwise.
          </p>
          <p>
            Delete anything yourself with <code>cortex_forget</code> in your editor, the trash button in
            the brain view, or <code>DELETE /v1/memories/&lt;id&gt;</code>. Take everything out with{' '}
            <code>GET /v1/export</code> — one portable JSON document — or stop the binary and delete{' '}
            <code>~/.cortex</code>. There is no &ldquo;delete my account&rdquo; button because there is no
            account; if hosted CORTEX ever ships, this policy is amended before that feature is turned
            on, not after.
          </p>
        </Section>

        <Section n="6" title="Everything else">
          <p>
            Not directed at children under 16; do not put a child&rsquo;s medical or behavioural data in a
            plain JSON file you sync over a mesh you wrote.
          </p>
          <p>
            The project is maintained from India and licensed AGPL-3.0-or-later (see{' '}
            <a href="/legal/terms">Terms</a>). Questions, and requests to delete something from the
            contact log: open an issue at{' '}
            <a href="https://github.com/Aryan-Protein-Vala/CORTEX" rel="noreferrer">
              the repository
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  )
}
