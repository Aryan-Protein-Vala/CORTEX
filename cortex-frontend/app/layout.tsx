import type { Metadata, Viewport } from 'next'
import AnalyticsGate from '../components/analytics'
import './globals.css'

/**
 * A project whose pitch is "no telemetry" must not enable pageview analytics by
 * accident: the marketing site loads Vercel Analytics only when this flag is set,
 * and the privacy page documents whichever way a deployment is configured.
 */
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_SITE_ANALYTICS === '1'

/**
 * Metadata is derived, not decorative: `metadataBase` has to exist or every
 * relative Open Graph URL resolves to nothing and links share without a card —
 * which is the only free distribution a launch like this gets.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
const TITLE = 'CORTEX — permanent memory for every AI you use'
const DESCRIPTION =
  'A local-first memory layer for AI: your ChatGPT, Claude and Gemini conversations become a memory graph that Cursor, Claude Desktop and your own agents read back through MCP. One Rust binary, your machine, no accounts.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s · CORTEX' },
  description: DESCRIPTION,
  applicationName: 'CORTEX',
  generator: 'cortex',
  keywords: [
    'AI memory',
    'model context protocol',
    'MCP',
    'knowledge graph',
    'local-first',
    'ChatGPT memory',
    'Claude Desktop',
    'Cursor rules',
    'self-hosted',
  ],
  authors: [{ name: 'Aryan Sharma', url: 'https://github.com/Aryan-Protein-Vala' }],
  creator: 'Aryan Sharma',
  openGraph: {
    type: 'website',
    siteName: 'CORTEX',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    creator: '@aryansharma',
  },
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#050505' },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="antialiased">
        {/* Keyboard users need a way past the nav. CSS-only: a server component
            may not carry event handlers, and focus is all this needs. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div id="main">{children}</div>
        <span id="top" />
        {ANALYTICS_ENABLED && <AnalyticsGate />}
      </body>
    </html>
  )
}
