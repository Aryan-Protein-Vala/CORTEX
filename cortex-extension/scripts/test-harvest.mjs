#!/usr/bin/env node
/**
 * Unit tests for the extension's decision logic (no browser needed).
 *   node scripts/test-harvest.mjs      # or: npm run test:extension
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(path.resolve(HERE, "..", "harvest-core.js"));

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}
function eq(actual, expected, label = "") {
  if (actual !== expected) throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, label) {
  if (!cond) throw new Error(label || "expected truthy");
}

check("module exports the whole decision surface", () => {
  for (const key of ["ADAPTERS", "adapterFor", "readParts", "planIngest", "contextBlock", "classifyError", "sessionKey", "turnKey"]) {
    ok(H[key] !== undefined, `missing export ${key}`);
  }
});

check("adapterFor resolves supported hosts and refuses others", () => {
  eq(H.adapterFor("chatgpt.com").id, "chatgpt");
  eq(H.adapterFor("claude.ai").id, "claude");
  eq(H.adapterFor("gemini.google.com").id, "gemini");
  eq(H.adapterFor("evil-corp.example"), null, "must not activate on unlisted sites");
});

check("readParts never touches non-text parts", () => {
  const content = {
    content_type: "multimodal_text",
    parts: [{ image_pointer: { asset_pointer: "a" } }, "what is in this screenshot?", null],
  };
  eq(H.readParts(content), "what is in this screenshot?");
  ok(!String(content.parts[0]).includes("CORTEX"), "must not mutate the caller's payload");
  eq(H.readParts({ parts: "plain string" }), "plain string");
  eq(H.readParts("bare string"), "bare string");
  eq(H.readParts(undefined), "");
  eq(H.readParts({ content_type: "code", parts: [] }), "");
});

check("ChatGPT request extraction reads the newest turn only", () => {
  const adapter = H.adapterFor("chatgpt.com");
  ok(adapter.request.match("https://chatgpt.com/backend-api/conversation"), "conversation url should match");
  ok(!adapter.request.match("https://chatgpt.com/backend-api/models"), "unrelated endpoint must not match");
  const turns = adapter.request.extract({
    messages: [
      { author: { role: "user" }, content: { content_type: "text", parts: ["older"] } },
      { author: { role: "assistant" }, content: { content_type: "text", parts: ["answer here"] } },
    ],
  });
  eq(turns.length, 1);
  eq(turns[0].role, "assistant");
  eq(turns[0].text, "answer here");
  eq(adapter.request.extract({}).length, 0, "no messages must be a no-op, not a crash");
  eq(adapter.request.extract({ messages: [{ author: { role: "user" }, content: { parts: [{ image: 1 }] } }] }).length, 0, "image-only turn stores nothing");
});

check("Claude request extraction tolerates unknown shapes", () => {
  const adapter = H.adapterFor("claude.ai");
  ok(adapter.request.match("https://claude.ai/api/organizations/org123/chat_conversations/abc/completion"));
  const turns = adapter.request.extract({
    new_message: { uuid: "x", content: [{ type: "text", text: "please refactor this" }] },
  });
  eq(turns.length, 1);
  eq(turns[0].text, "please refactor this");
  eq(adapter.request.extract({ prompt: "legacy shape" }).length, 0, "unknown shape must yield nothing rather than guess");
});

check("planIngest dedupes, caps and skips noise", () => {
  const turns = [
    { role: "user", text: "I prefer Rust for the parser crate" },
    { role: "user", text: "I prefer Rust for the parser crate" },
    { role: "user", text: "ok" },
    { role: "assistant", text: "Great choice, here is the plan for the parser crate." },
  ];
  const first = H.planIngest(turns, new Set());
  eq(first.length, 2, "duplicate and 2-char turn must be dropped");
  const seen = new Set(first.map((t) => t.key));
  eq(H.planIngest(turns, seen).length, 0, "already-seen turns must not be resent");
  const big = Array.from({ length: 200 }, (_, i) => ({ role: "user", text: `memory number ${i} about the project setup` }));
  const capped = H.planIngest(big, new Set(), { maxChars: 4000, maxTurns: 50 });
  ok(capped.length <= 50, "turn cap enforced");
  ok(capped.reduce((n, t) => n + t.text.length, 0) <= 4000, "char budget enforced");
});

check("contextBlock refuses to inject an empty brain", () => {
  // This was the launch bug: every prompt got "[CORTEX CONTEXT]: Found rules…"
  // style text even when the core knew nothing.
  eq(H.contextBlock("No relevant memories found for this query in cortex://default (scanned 0 nodes).", "composer"), "");
  eq(H.contextBlock("no memories recorded under cortex://me yet.", "request"), "");
  eq(H.contextBlock("", "composer"), "");
  eq(H.contextBlock("   ", "composer"), "");
  const block = H.contextBlock("- User prefers Rust\n- must_not use raw SQL", "composer");
  ok(block.includes("safe to edit or delete"), "composer mode must tell the user it is editable");
  ok(block.includes("[/CORTEX MEMORY]"), "block must be self-delimiting");
  ok(!/system prompt|you are/i.test(block), "must not impersonate the app's system prompt");
  const long = H.contextBlock("x".repeat(9000), "request", 500);
  ok(long.length < 700, "long briefings must be truncated");
  ok(long.includes("truncated by CORTEX"), "truncation must be admitted");
});

check("stripBlock removes our own injection before re-ingest", () => {
  const injected = H.contextBlock("- User prefers Rust", "request");
  const sent = injected + "now add an index";
  const stripped = H.stripBlock(sent);
  eq(stripped, "now add an index");
});

check("classifyError gives an actionable line per failure mode", () => {
  ok(/key/.test(H.classifyError(null, 401).text), "401 must mention the key");
  eq(H.classifyError(null, 401).kind, "auth");
  eq(H.classifyError(null, 429).kind, "rate");
  eq(H.classifyError({ name: "AbortError" }).kind, "timeout");
  eq(H.classifyError({ name: "TypeError", message: "Failed to fetch" }).kind, "offline");
  ok(/cargo run/.test(H.classifyError({ message: "boom" }).text), "offline path says how to start the core");
});

check("sessionKey isolates tabs and sites", () => {
  const a = H.sessionKey(7, "chatgpt.com");
  eq(a, H.sessionKey(7, "chatgpt.com"));
  ok(a !== H.sessionKey(8, "chatgpt.com"), "different tab must be a different session");
  ok(a !== H.sessionKey(7, "claude.ai"), "different site must be a different session");
  ok(!/[.\s]/.test(a), "session keys stay URL-safe");
});

check("hash is stable and role-sensitive turnKey", () => {
  eq(H.hash("durable fact"), H.hash("durable fact"));
  ok(H.hash("durable fact") !== H.hash("other fact"), "hash collides on trivial input");
  ok(H.turnKey({ role: "user", text: "same" }) !== H.turnKey({ role: "assistant", text: "same" }));
  eq(H.clean("  a\u00a0b \n\n\n\nc  "), "a b\n\nc");
});

check("gemini adapter is flagged experimental and degrades silently", () => {
  const gemini = H.adapterFor("gemini.google.com");
  ok(gemini.experimental, "gemini must be marked experimental in code, not only in docs");
  eq(gemini.request, null);
});

console.log(`\n${failed ? `${failed} FAILURE(S)` : "all extension logic checks passed"}`);
process.exit(failed ? 1 : 0);
