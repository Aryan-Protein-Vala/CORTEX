#!/usr/bin/env node
/**
 * The parent-chain traversal, tested. This is the bug class that shipped the
 * "hydrate your ChatGPT history" feature in a state where it ingested the wrong
 * text: it walked object keys instead of the tree.
 */
import assert from "node:assert/strict";
import { linearThread, parseHydratePayload, textFromContent, transcriptFromOpenAi, transcriptFromRaw } from "../lib/hydrate.ts";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

const mapping = {
  root: { id: "root", parent: null, message: { author: { role: "user" }, content: { content_type: "text", parts: ["memory: use pnpm"] } } },
  a: { id: "a", parent: "root", message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["noted"] } } },
  branch: { id: "branch", parent: "a", message: { author: { role: "user" }, content: { content_type: "text", parts: ["ABANDONED BRANCH"] } } },
  current: { id: "current", parent: "a", message: { author: { role: "user" }, content: { content_type: "text", parts: ["never hand-write SQL"] } } },
};

test("follows parent links from current_node, not key order", () => {
  const chain = linearThread(mapping, "current");
  assert.deepEqual(chain.map((n) => n.id), ["root", "a", "current"]);
  assert.ok(!chain.some((n) => n.id === "branch"), "an abandoned sibling must not be included");
});

test("transcript keeps speaker prefixes the core's extractor depends on", () => {
  const { text, turns } = transcriptFromOpenAi({ title: "Stack rules", mapping, current_node: "current" });
  assert.equal(turns, 3);
  assert.match(text, /^Conversation: Stack rules/);
  assert.match(text, /USER: memory: use pnpm\nASSISTANT: noted\nUSER: never hand-write SQL$/);
  assert.ok(!text.includes("ABANDONED"));
});

test("title-only conversations report zero turns so the route skips them", () => {
  const built = transcriptFromOpenAi({ title: "empty", mapping: {} });
  assert.equal(built.turns, 0);
});

test("multimodal parts skip image objects instead of stringifying them", () => {
  const imagePointer = { content_type: "multimodal_text", parts: [{ image_url: { url: "https://x/y.png" } }, "what does this say?"] };
  assert.equal(textFromContent(imagePointer), "what does this say?");
  assert.ok(!textFromContent(imagePointer).includes("[object Object]"));
});

test("cycles in a corrupt export terminate", () => {
  const cyclic = { x: { id: "x", parent: "y", message: { author: { role: "user" }, content: { parts: ["x"] } } }, y: { id: "y", parent: "x", message: { author: { role: "user" }, content: { parts: ["y"] } } } };
  const chain = linearThread(cyclic, "x");
  assert.ok(chain.length <= 2, `expected the walk to stop, got ${chain.length}`);
});

test("fallback picks the longest root path when current_node dangles", () => {
  const built = transcriptFromOpenAi({ title: "t", mapping, current_node: "does-not-exist" }, { keepTitles: false });
  assert.ok(built.text.includes("memory: use pnpm"));
  assert.ok(built.text.includes("ABANDONED BRANCH") || built.text.includes("never hand-write SQL"));
});

test("raw text transcript defaults unknown lines to USER", () => {
  const built = transcriptFromRaw("use bun for scripts\nASSISTANT: ok");
  assert.equal(built.text, "USER: use bun for scripts\nASSISTANT: ok");
  assert.equal(built.turns, 2);
});

test("payload parsing requires an explicit confirm", () => {
  const without = parseHydratePayload({ conversations: [{}], owner: "cortex://me" });
  assert.equal(without.confirm, false);
  assert.equal(without.owner, "cortex://me");
  const badShape = parseHydratePayload({ nope: 1 });
  assert.match(badShape.error ?? "", /Expected/);
});

console.log(`\n${passed}/8 hydration checks passed`);
