'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Vercel Analytics, loaded lazily and only when the deployment opted in.
 *
 * Why the ceremony: this project's pitch is "no telemetry", so a static import
 * in the root layout would ship a pageview beacon on every deployment — and a
 * marketing site that says "we collect nothing" while loading one is exactly the
 * kind of drift that ends a local-first product's credibility. Two things make
 * that impossible here:
 *
 *   1. the flag is read server-side (`NEXT_PUBLIC_SITE_ANALYTICS=1`), and the
 *      component is not rendered at all when it is off, so the script is never
 *      fetched — not merely disabled after the fact;
 *   2. `next/dynamic` with `ssr: false` keeps it out of the server render, so a
 *      pageview that never happened cannot be reported from HTML.
 *
 * The privacy page documents both configurations.
 */
const Analytics = dynamic(
  () => import('@vercel/analytics/next').then((mod) => mod.Analytics),
  { ssr: false, loading: () => null },
)

export default function AnalyticsGate() {
  // Re-arm on route change so a SPA navigation is not missed if Vercel's
  // instrumentation ever needs a nudge; harmless when it does not.
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) return null
  return <Analytics key={pathname} />
}
