import { NextResponse } from "next/server"

/**
 * Retroactive hydration: turn an exported history (ChatGPT `conversations.json`,
 * a plain `.txt`/`.jsonl` transcript, or an array of `{role, content}` messages)
 * into memory-graph facts.
 *
 * Two things the first version got wrong, both fixed here:
 *  - it iterated `Object.keys(mapping)`, i.e. every branch of the conversation
 *    tree in arbitrary order, instead of following `parent` from the current
 *    node, so replies were interleaved with abandoned branches;
 *  - it shipped the whole blob under a `prompt:` key with no speaker markers, so
 *    assistant text was extracted as if the user had asserted it.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

const CORE_URL = (process.env.CORTEX_API_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "")
const CORE_KEY = process.env.CORTEX_API_KEY ?? ""
const MAX_CONVERSATIONS = Number(process.env.CORTEX_HYDRATE_MAX ?? 250)
const MAX_TURNS_PER_CONVERSATION = 60
const MAX_TRANSCRIPT_CHARS = 12_000
const CONCURRENCY = 3
const TURNS_PER_CONVERSATION = 60
const TRANSCRIPT_CHARS = 12_000

import { parseHydratePayload, transcriptFromOpenAi, transcriptFromRaw } from "@/lib/hydrate"

async function ingest(transcript: string, owner: string): Promise<{ ok: boolean; status: number; error?: string; jobId?: string }> {
  try {
    const response = await fetch(`${CORE_URL}/v1/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(CORE_KEY ? { "x-cortex-key": CORE_KEY } : {}),
      },
      body: JSON.stringify({ owner, prompt: transcript, source: "hydrator" }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    if (!response.ok) {
      return { ok: false, status: response.status, error: payload?.error?.message ?? `HTTP ${response.status}` }
    }
    return { ok: true, status: response.status, jobId: payload?.job_id }
  } catch (error) {
    return { ok: false, status: 0, error: (error as Error).message }
  }
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { conversations: [...] } or a raw { text } transcript." }, { status: 400 })
  }

  const parsed = parseHydratePayload(payload)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!parsed.confirm) {
    return NextResponse.json(
      { error: "Hydration writes memory. Re-send with { confirm: true } to acknowledge that." },
      { status: 400 }
    )
  }
  const owner = parsed.owner
  const list = parsed.conversations

  const transcripts: { text: string; turns: number }[] = []
  const skipped: { index: number; reason: string }[] = []

  if (list.length) {
    for (const [index, conversation] of list.entries()) {
      if (index >= MAX_CONVERSATIONS) {
        skipped.push({ index, reason: `over the CORTEX_HYDRATE_MAX limit of ${MAX_CONVERSATIONS}` })
        continue
      }
      if (!conversation || typeof conversation !== "object") {
        skipped.push({ index, reason: "not an object" })
        continue
      }
      const built = transcriptFromOpenAi(conversation as Record<string, unknown>)
      if (built.turns === 0) {
        skipped.push({ index, reason: "no user/assistant messages on the parent chain" })
        continue
      }
      transcripts.push(built)
    }
  } else {
    const built = transcriptFromRaw(parsed.text)
    if (built.turns === 0) return NextResponse.json({ error: "The text contained no usable lines." }, { status: 400 })
    transcripts.push(built)
  }

  if (!transcripts.length) {
    return NextResponse.json({
      success: false,
      queued: 0,
      skipped: skipped.length,
      skip_reasons: skipped.slice(0, 10),
      message: "Nothing to queue — no user or assistant messages were found on any parent chain.",
    })
  }

  const health = await fetch(`${CORE_URL}/health`, { signal: AbortSignal.timeout(5000), headers: CORE_KEY ? { "x-cortex-key": CORE_KEY } : {} })
    .then((response) => (response.ok ? (response.json() as Promise<{ backend?: string; services?: { extraction?: boolean } }>) : null))
    .catch(() => null)
  if (!health) {
    return NextResponse.json(
      { error: `No CORTEX core reachable at ${CORE_URL}. Start it with \`cargo run --release --bin cortex-core\` and retry; nothing was queued.` },
      { status: 503 }
    )
  }

  const queue = [...transcripts]
  const results: { ok: boolean; jobId?: string; error?: string }[] = []
  let rateLimited = 0

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      const outcome = await ingest(next.text, owner)
      if (!outcome.ok && outcome.status === 429) {
        rateLimited += 1
        queue.push(next) // put it back and let the window reset
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }
      results.push(outcome)
    }
  })
  await Promise.all(workers)

  const accepted = results.filter((result) => result.ok).length
  const failures = results.filter((result) => !result.ok)
  const message =
    accepted === 0
      ? failures[0]?.error
        ? `Nothing was queued: ${failures[0].error}`
        : "Nothing to queue — every conversation was skipped."
      : `Queued ${accepted} conversation(s) for extraction (${
          health?.services?.extraction ? "LLM extractor" : "offline heuristics — set OPENROUTER_API_KEY on the core for full extraction"
        }).`

  return NextResponse.json({
    success: accepted > 0,
    queued: accepted,
    skipped: skipped.length,
    skip_reasons: skipped.slice(0, 10),
    failed: failures.length,
    first_errors: failures.slice(0, 3).map((failure) => failure.error),
    rate_limit_retries: rateLimited,
    turns_seen: transcripts.reduce((total, item) => total + item.turns, 0),
    owner,
    backend: health.backend,
    poll: "/v1/jobs/<job_id> · or the dashboard feed",
    message,
  })
}

export async function GET() {
  return NextResponse.json({
    purpose: "POST an OpenAI conversations.json array (or { text }) to hydrate CORTEX with your history.",
    requires: ["confirm: true", "a running core"],
    limits: { conversations: MAX_CONVERSATIONS, turnsPerConversation: TURNS_PER_CONVERSATION, transcriptChars: TRANSCRIPT_CHARS },
    core_url: CORE_URL,
  })
}
