import { NextResponse } from "next/server"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

/**
 * Contact form sink.
 *
 * The previous version logged to stdout and replied "Transmission received" —
 * i.e. it told people their message was delivered while deleting it. Now: the
 * submission is written to `CORTEX_CONTACT_FILE` (JSONL) and only then
 * acknowledged. Without that env var the route says so in a 503, because an
 * operator who has not wired an inbox should find that out from the form, not
 * from a missing lead.
 */

export const dynamic = "force-dynamic"

const MAX_MESSAGE = 4000
const MAX_FIELD = 200
const CONTACT_FILE = process.env.CORTEX_CONTACT_FILE ?? ""

// Single-instance courtesy limit; a real deployment puts this behind a queue.
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 5
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return false
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= MAX_FIELD
}

function clamp(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, max)
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Send JSON: { name, email, message }." }, { status: 400 })
  }

  // Honeypot: silently "succeed" for bots that fill hidden fields.
  if (clamp(body.website, 200).length > 0) {
    return NextResponse.json({ success: true, message: "Transmission received." })
  }

  const name = clamp(body.name, MAX_FIELD)
  const email = clamp(body.email, MAX_FIELD)
  const message = clamp(body.message, MAX_MESSAGE)

  if (!name || !email || !message) {
    return NextResponse.json({ error: "name, email and message are all required." }, { status: 400 })
  }
  if (!validEmail(email)) {
    return NextResponse.json({ error: "That email address is not valid, so we could not reply." }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many submissions from this address in the last 10 minutes. Try again shortly." },
      { status: 429 }
    )
  }

  if (!CONTACT_FILE) {
    return NextResponse.json(
      {
        error:
          "The site has no inbox configured (set CORTEX_CONTACT_FILE to a JSONL path, or point the form at your own issue tracker). Nothing was stored.",
      },
      { status: 503 }
    )
  }

  const record = { at: new Date().toISOString(), name, email, message, via: "contact-form" }
  try {
    await mkdir(path.dirname(CONTACT_FILE), { recursive: true })
    await appendFile(CONTACT_FILE, `${JSON.stringify(record)}\n`, "utf8")
  } catch (error) {
    return NextResponse.json(
      { error: `Could not write to the configured inbox: ${(error as Error).message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message: "Saved. We read this inbox daily and reply to the address you gave.",
  })
}
