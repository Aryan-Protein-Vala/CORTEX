import { NextResponse } from "next/server";

/**
 * Same-origin proxy to the CORTEX core.
 *
 * Why this exists instead of `fetch("http://localhost:3030")` from a component:
 *  - the core's key stays on the server (previously the dashboard could not
 *    authenticate at all, so it showed fake data instead);
 *  - an https deploy never issues a mixed-content request to plain http;
 *  - no CORS or Private-Network-Access preflight to fight with, which browsers
 *    now block by default.
 *
 * It is an allowlist, not a tunnel: only the read/write endpoints the dashboard
 * uses. `/v1/export`, `/v1/import` and mesh publishing stay unreachable from a
 * browser on purpose.
 */

export const dynamic = "force-dynamic"

const CORE_URL = (process.env.CORTEX_API_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "")
const CORE_KEY = process.env.CORTEX_API_KEY ?? ""
const TIMEOUT_MS = Number(process.env.CORTEX_PROXY_TIMEOUT_MS ?? 45_000)
const PREFIX = "/api/core"

const ALLOWED = [
  "/health",
  "/v1/recall",
  "/v1/ingest",
  "/v1/inject",
  "/v1/memories",
  "/v1/session/message",
  "/v1/flush",
  "/v1/jobs",
  "/v1/stats",
  "/v1/sweep",
  "/v1/resolve",
] as const

function isAllowed(pathname: string): boolean {
  return ALLOWED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`)
  )
}

async function handle(request: Request): Promise<Response> {
  const incoming = new URL(request.url)
  const suffix = incoming.pathname.startsWith(PREFIX) ? incoming.pathname.slice(PREFIX.length) || "/health" : incoming.pathname

  if (!isAllowed(suffix)) {
    return NextResponse.json(
      {
        error: {
          code: "proxy_path_denied",
          message: `${suffix} is not proxyable from the browser. Add it to the allowlist in app/api/core/[...path]/route.ts only if the dashboard genuinely needs it.`,
        },
      },
      { status: 403 }
    )
  }

  const target = `${CORE_URL}${suffix}${incoming.search}`
  const headers: Record<string, string> = { accept: "application/json" }
  if (CORE_KEY) headers["x-cortex-key"] = CORE_KEY
  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const contentType = request.headers.get("content-type")
  if (hasBody && contentType) headers["content-type"] = contentType

  let body: string | undefined
  if (hasBody) {
    const raw = await request.text()
    body = raw.length ? raw : undefined
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // The core authenticates by bearer/header only; cookies are never forwarded.
      credentials: "omit",
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        // Which core answered, without leaking the key. Handy in support threads.
        "x-cortex-backend": new URL(CORE_URL).host,
      },
    })
  } catch (error) {
    const name = (error as Error)?.name ?? ""
    const timedOut = name === "TimeoutError" || name === "AbortError"
    return NextResponse.json(
      {
        error: {
          code: "core_unreachable",
          message: timedOut
            ? `The core at ${CORE_URL} did not answer within ${Math.round(TIMEOUT_MS / 1000)}s — extraction may be waiting on a slow model.`
            : `No CORTEX core is reachable at ${CORE_URL}. Start it with \`cargo run --release --bin cortex-core\`, or set CORTEX_API_URL to the machine that runs it.`,
        },
      },
      { status: 503 }
    )
  }
}

export const GET = handle
export const POST = handle
export const DELETE = handle
