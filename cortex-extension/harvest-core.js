/**
 * CORTEX extension — pure logic (no DOM, no chrome APIs).
 *
 * Shared by the content script, the page-world injector, the service worker and
 * the node test suite (`npm run test:extension`). Everything that decides *what
 * gets remembered* lives here so it can be tested without a browser.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.CortexHarvest = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Site adapters
  // -------------------------------------------------------------------------
  // These selectors are someone else's DOM and will break without notice. Every
  // adapter therefore has to fail the same way: return no turns, never throw,
  // never guess. `probe` is what the popup shows as "not detected".

  var ADAPTERS = [
    {
      id: "chatgpt",
      origin: "https://chatgpt.com",
      label: "ChatGPT",
      turn: 'div[data-message-author-role]',
      authorAttr: "data-message-author-role",
      streaming: 'button[aria-label*="Stop" i], .result-streaming, [data-testid="stop-button"]',
      // Request body shape: {messages:[{author:{role},content:{content_type,parts:[]}}]}
      request: {
        match: function (url) { return /\/backend-api\/(anonymous\/)?conversation/.test(url); },
        extract: function (body) {
          var messages = body && body.messages;
          if (!Array.isArray(messages) || !messages.length) return [];
          var last = messages[messages.length - 1];
          var author = (last && last.author && last.author.role) || "user";
          var text = readParts(last && last.content);
          return text ? [{ role: author === "user" ? "user" : "assistant", text: text }] : [];
        },
      },
    },
    {
      id: "claude",
      origin: "https://claude.ai",
      label: "Claude",
      turn: 'div[data-testid="assistant-message-text"], [data-testid="user-message"], div[data-message-author-role]',
      authorFromNode: function (node) {
        var attr = node.getAttribute && node.getAttribute("data-message-author-role");
        if (attr) return attr === "user" ? "user" : "assistant";
        var testid = (node.getAttribute && node.getAttribute("data-testid")) || "";
        if (/user/i.test(testid)) return "user";
        return "assistant";
      },
      streaming: 'button[aria-label*="Stop" i], [data-is-streaming="true"]',
      // Documented shape: {new_message:{content:[{type:"text",text}]}, completion:{...}}
      // Kept best-effort on purpose: if it does not match, we fall back to DOM.
      request: {
        match: function (url) {
          return /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|append_message)/.test(url);
        },
        extract: function (body) {
          var out = [];
          var user = body && body.new_message && body.new_message.content;
          if (Array.isArray(user)) {
            var text = user.filter(function (p) { return p && p.type === "text" && p.text; }).map(function (p) { return p.text; }).join("\n");
            if (text) out.push({ role: "user", text: text });
          }
          return out;
        },
      },
    },
    {
      id: "gemini",
      origin: "https://gemini.google.com",
      label: "Gemini",
      // Experimental: selectors here are shadow-DOM hosted, so the light-DOM pass
      // is only expected to find the response wrapper. When it yields nothing the
      // popup says "not detected" instead of pretending.
      experimental: true,
      turn: 'message-content, .model-response-text, .conversation-container',
      authorFromNode: function (node) {
        var tag = (node.tagName || "").toLowerCase();
        return tag === "message-content" ? "assistant" : "assistant";
      },
      streaming: '.generation-in-progress, button[aria-label*="Stop" i]',
      request: null,
    },
  ];

  /** Read a ChatGPT-style `content` object without corrupting non-text parts. */
  function readParts(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    var parts = content.parts;
    if (typeof parts === "string") return parts;
    if (!Array.isArray(parts)) return "";
    // Multimodal turns lead with an image pointer object. Only join the strings,
    // and never write anything back: `parts[0] += text` used to mangle images.
    return parts
      .filter(function (p) { return typeof p === "string"; })
      .join("\n")
      .trim();
  }

  function adapterFor(hostname) {
    var host = String(hostname || "").toLowerCase();
    for (var i = 0; i < ADAPTERS.length; i++) {
      var a = ADAPTERS[i];
      try {
        if (host === new URL(a.origin).hostname || host.endsWith("." + new URL(a.origin).hostname)) return a;
      } catch (e) {
        /* malformed config: skip */
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Turn collection
  // -------------------------------------------------------------------------

  function hash(text) {
    // FNV-1a 32-bit — stable dedupe key, no crypto dependency in a content script.
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function turnKey(turn) {
    return turn.role + ":" + hash(turn.text);
  }

  /**
   * Drop turns already stored this session, enforce caps, and keep only what is
   * worth an extraction pass. Assistant turns are forwarded (the core needs them
   * for context) but are never treated as facts by the core's extractor.
   */
  function planIngest(turns, seenKeys, options) {
    var opts = options || {};
    var maxChars = opts.maxChars || 16000;
    var maxTurns = opts.maxTurns || 50;
    var out = [];
    var budget = maxChars;
    var list = (turns || []).slice(-maxTurns);
    var inBatch = new Set();
    for (var i = 0; i < list.length; i++) {
      var turn = { role: list[i].role === "user" ? "user" : "assistant", text: clean(list[i].text) };
      if (turn.text.length < (opts.minChars || 12)) continue;
      var key = turnKey(turn);
      // Already sent in an earlier batch, or repeated inside this one (the DOM
      // observer fires per mutation, so the same turn shows up many times).
      if ((seenKeys && seenKeys.has(key)) || inBatch.has(key)) continue;
      inBatch.add(key);
      if (turn.text.length > budget) break;
      budget -= turn.text.length;
      out.push({ key: key, role: turn.role, text: turn.text });
    }
    return out;
  }

  /**
   * Render a briefing for injection into a prompt.
   * `mode`:
   *  - "composer": visible text the user can edit or delete before sending.
   *  - "request":  appended to the outgoing request body (experimental).
   * Never prepend silently: the block is always bracketed and self-describing.
   */
  function contextBlock(briefing, mode, maxChars) {
    var body = clean(briefing);
    if (!body) return "";
    if (/^\s*(no relevant memories|no memories recorded)\b/i.test(body)) return "";
    var cap = maxChars || 2400;
    if (body.length > cap) body = body.slice(0, cap) + "\n… (truncated by CORTEX)";
    var header =
      mode === "composer"
        ? "[CORTEX MEMORY — inserted by the CORTEX extension, safe to edit or delete before sending]"
        : "[CORTEX MEMORY — added by the CORTEX extension request-rewriter; the core enforces the token budget]";
    return header + "\n" + body + "\n[/CORTEX MEMORY]\n\n";
  }

  /**
   * Remove our own injection so a re-read of the composer never stores CORTEX's
   * own text as if the user had said it (that feedback loop is how memory
   * products poison themselves).
   */
  function stripBlock(text) {
    return String(text == null ? "" : text)
      .replace(/\[CORTEX MEMORY[\s\S]*?\[\/CORTEX MEMORY\]\n\n?/g, "")
      .trim();
  }

  /** Turns the user can see are auditable: keep a short local log. */
  function summarizeStored(report) {
    if (!report) return { triplets: 0, message: "no response from the core" };
    return {
      triplets: report.triplets_extracted || 0,
      newNodes: report.nodes_new || 0,
      newEdges: report.edges_new || 0,
      warnings: report.warnings || [],
      extractor: report.extractor || "unknown",
    };
  }

  /** Human-readable failure text for the popup; drives the badge too. */
  function classifyError(error, status, code) {
    if (status === 401 || status === 403) {
      return { kind: "auth", text: "The core rejected the key — set CORTEX_API_KEY in the popup to match the core's key." };
    }
    if (status === 429) {
      return { kind: "rate", text: "Core is rate limiting this browser. Slow the buffer down in settings." };
    }
    if (status === 503) {
      return { kind: "backend", text: "The core is up but its storage is unavailable." };
    }
    if (error && /abort|timeout/i.test(String(error.name || error.message || ""))) {
      return { kind: "timeout", text: "The core did not answer in time. Is extraction waiting on a slow LLM?" };
    }
    if (error) {
      return { kind: "offline", text: "Cannot reach the core. Start it with `cargo run --release --bin cortex-core`." };
    }
    return { kind: code ? "core" : "unknown", text: "Core error" + (code ? " (" + code + ")" : "") };
  }

  function sessionKey(tabId, hostname) {
    return "ext-" + String(hostname || "site").replace(/[^a-z0-9]/gi, "") + "-" + tabId;
  }

  return {
    ADAPTERS: ADAPTERS,
    adapterFor: adapterFor,
    readParts: readParts,
    clean: clean,
    hash: hash,
    turnKey: turnKey,
    planIngest: planIngest,
    contextBlock: contextBlock,
    stripBlock: stripBlock,
    summarizeStored: summarizeStored,
    classifyError: classifyError,
    sessionKey: sessionKey,
  };
});
