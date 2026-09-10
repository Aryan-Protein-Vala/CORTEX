/**
 * OpenAI/GPT export → CORTEX transcript, as pure functions.
 *
 * Kept separate from the route so the traversal is unit-testable (this is the
 * logic that used to iterate `Object.keys(mapping)` and store abandoned branches,
 * and that used to send assistant prose as if the user had asserted it).
 */

export type MappingNode = {
  id?: string
  parent?: string | null
  children?: string[]
  message?: {
    author?: { role?: string }
    content?: { content_type?: string; parts?: unknown[] } | string
  }
}

export type Transcript = { text: string; turns: number }

/** Only real string parts. Image pointers and objects are skipped, never coerced. */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!content || typeof content !== "object") return ""
  const parts = (content as { parts?: unknown }).parts
  if (typeof parts === "string") return parts
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .trim()
}

/**
 * The chronological chain, following `parent` links from `currentNode` back to
 * the root and then reversing. Falls back to the longest root-to-leaf path when
 * `current_node` is missing or dangling.
 */
export function linearThread(mapping: Record<string, MappingNode>, currentNode?: string): MappingNode[] {
  const nodes = Object.values(mapping ?? {}).filter((node) => node && typeof node === "object")
  if (!nodes.length) return []

  const walkUp = (start: MappingNode): MappingNode[] => {
    const chain: MappingNode[] = []
    const seen = new Set<string>()
    let cursor: MappingNode | undefined = start
    while (cursor && chain.length < 1000) {
      const key = cursor.id ?? JSON.stringify(cursor).slice(0, 32)
      if (seen.has(key)) break // cyclic export: stop rather than spin forever
      seen.add(key)
      chain.unshift(cursor)
      cursor = cursor.parent ? mapping[cursor.parent] : undefined
    }
    return chain
  }

  if (currentNode && mapping[currentNode]) return walkUp(mapping[currentNode])

  let best: MappingNode[] = []
  for (const node of nodes) {
    const chain = walkUp(node)
    if (chain.length > best.length) best = chain
  }
  return best
}

const MAX_TURNS = 60
const MAX_CHARS = 12_000

/**
 * Build the transcript the core expects. Speaker prefixes matter: the core's
 * extractor treats `USER:` lines as facts and everything else as context.
 */
export function transcriptFromOpenAi(
  conversation: Record<string, unknown>,
  options: { maxTurns?: number; maxChars?: number; keepTitles?: boolean } = {}
): Transcript {
  const maxTurns = options.maxTurns ?? MAX_TURNS
  const maxChars = options.maxChars ?? MAX_CHARS
  const mapping = conversation?.mapping
  const lines: string[] = []

  if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
    const chain = linearThread(mapping as Record<string, MappingNode>, String(conversation.current_node ?? "") || undefined)
    for (const node of chain) {
      const role = node.message?.author?.role
      if (role !== "user" && role !== "assistant") continue
      const text = textFromContent(node.message?.content)
      if (!text) continue
      lines.push(`${role.toUpperCase()}: ${text.slice(0, 4000)}`)
      if (lines.length >= maxTurns) break
    }
  } else if (Array.isArray(conversation?.message)) {
    for (const message of conversation.message as { role?: string; content?: unknown }[]) {
      const role = message?.role === "assistant" ? "ASSISTANT" : "USER"
      const text = textFromContent(message?.content)
      if (text) lines.push(`${role}: ${text.slice(0, 4000)}`)
    }
  }

  if (options.keepTitles === false) {
    return { text: lines.join("\n").slice(-maxChars), turns: lines.length }
  }
  const title = typeof conversation?.title === "string" ? conversation.title : "Untitled"
  const body = lines.slice(-maxTurns).join("\n")
  const text = body ? `Conversation: ${title}\n${body}` : `Conversation: ${title}`
  return { text: text.slice(-maxChars), turns: lines.length }
}

/** Plain text / jsonl history: unknown lines are attributed to the user. */
export function transcriptFromRaw(body: unknown, maxChars = MAX_CHARS): Transcript {
  if (typeof body !== "string") return { text: "", turns: 0 }
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400)
    .map((line) => (/^(USER|ASSISTANT|SYSTEM|TOOL):/i.test(line) ? line : `USER: ${line}`))
  return { text: lines.join("\n").slice(0, maxChars), turns: lines.length }
}

/** Which of the two supported payload shapes was posted? */
export function parseHydratePayload(payload: unknown): {
  conversations: unknown[]
  text: string | null
  owner: string
  confirm: boolean
  error: string | null
} {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
  const confirm = record.confirm === true || record.confirm === "true"
  const owner = String(record.owner ?? record.user_id ?? "cortex://default")
  const list = Array.isArray(record.conversations)
    ? (record.conversations as unknown[])
    : Array.isArray(payload)
      ? (payload as unknown[])
      : []
  const text = typeof record.text === "string" ? record.text : null

  if (!list.length && !text) {
    return { conversations: [], text, owner, confirm, error: 'Expected { conversations: [...] } (OpenAI export array) or { text: "..." }.' }
  }
  return { conversations: list, text, owner, confirm, error: null }
}
