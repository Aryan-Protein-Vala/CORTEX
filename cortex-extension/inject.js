/**
 * CORTEX page-world hook (MAIN world).
 *
 * Two jobs, both conditional on the mode the user chose:
 *  - harvest: read the *actual* request body, which is far more reliable than
 *    scraping the DOM (and works even when the app virtualises its transcript);
 *  - rewrite (opt-in "request" mode only): append the memory block to an
 *    existing text part. It never creates a part, never touches non-text parts
 *    and gives up silently if the shape is unexpected — corrupting a user's
 *    outgoing message is the one failure this file is not allowed to have.
 */
(function () {
  "use strict";

  const H = window.CortexHarvest;
  if (!H || typeof window.fetch !== "function") return;

  const mode = { current: "remember", budget: 400, ready: false };

  // Ask the isolated bridge which mode the user picked; stay passive until told.
  function handshake() {
    const onConfig = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "CORTEX_BRIDGE" || data.type !== "CORTEX_CONFIG_RES") return;
      window.removeEventListener("message", onConfig);
      mode.current = data.mode || "remember";
      mode.budget = data.budget || 400;
      mode.ready = true;
    };
    window.addEventListener("message", onConfig);
    window.postMessage({ source: "CORTEX_INJECTOR", type: "CORTEX_CONFIG_REQ" }, window.location.origin);
    setTimeout(() => {
      if (!mode.ready) {
        // No bridge (e.g. the content script failed to load): never rewrite.
        mode.current = "remember";
        mode.ready = true;
      }
    }, 800);
  }
  handshake();

  const adapter = H.adapterFor(location.hostname);
  if (!adapter) return;

  const originalFetch = window.fetch;

  function textOf(body) {
    if (typeof body === "string") return body;
    if (body && typeof body.text === "function") return null; // unreadable stream: skip
    return null;
  }

  function harvest(turns) {
    if (!turns || !turns.length) return;
    if (mode.current === "remember" && !mode.ready) return;
    window.postMessage({ source: "CORTEX_INJECTOR", type: "CORTEX_TURNS", turns }, window.location.origin);
  }

  window.fetch = async function (resource, init) {
    const url = typeof resource === "string" ? resource : resource && resource.url ? resource.url : "";
    const shouldInspect = adapter.request && adapter.request.match(url);
    if (!shouldInspect) return originalFetch.apply(this, arguments);

    let parsed = null;
    const rawBody = textOf((init && init.body) || (resource && resource.body));
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch (error) {
        parsed = null; // not JSON we understand: pass through untouched
      }
    }

    if (parsed) {
      let turns = [];
      // 1. Harvest exactly what is being sent (already free of our own block).
      try {
        turns = (adapter.request.extract(parsed) || []).map((t) => ({ role: t.role, text: H.stripBlock(t.text) }));
      } catch (error) {
        turns = [];
      }
      harvest(turns);

      // 2. Rewrite only when the user explicitly enabled it, and only with the
      // briefing for *this* prompt (a cached one from the previous question would
      // be worse than none).
      if (mode.current === "request" && init) {
        const userTurn = turns.filter((t) => t.role === "user").pop();
        if (userTurn && userTurn.text) {
          const briefing = await briefingFor(userTurn.text, 1200);
          const next = appendContext(parsed, H.contextBlock(briefing, "request", (mode.budget || 400) * 4));
          if (next) {
            const headers = new Headers((init.headers || (resource && resource.headers)) || {});
            if (!headers.has("content-type")) headers.set("content-type", "application/json");
            const clone = new Request(url, { ...toRequestInit(init), body: JSON.stringify(next), headers });
            return originalFetch.call(this, clone, undefined);
          }
        }
      }
    }

    return originalFetch.apply(this, arguments);
  };

  function toRequestInit(init) {
    const out = {};
    for (const key of ["method", "headers", "body", "mode", "credentials", "cache", "signal", "integrity", "keepalive", "referrer", "referrerPolicy", "duplex"]) {
      if (init[key] !== undefined) out[key] = init[key];
    }
    return out;
  }

  let cachedBriefing = { key: "", text: "", at: 0 };

  async function briefingFor(prompt, waitMs) {
    if (!prompt) return "";
    const now = Date.now();
    // Same prompt retried within 6s (network hiccup) reuses the answer.
    if (cachedBriefing.key === prompt && now - cachedBriefing.at < 6000) return cachedBriefing.text;
    const text = await new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener("message", listener);
        resolve("");
      }, Math.min(2000, Math.max(150, waitMs || 1200))); // the user's send never waits on us
      const listener = (event) => {
        const data = event.data;
        if (event.source !== window || !data || data.source !== "CORTEX_BRIDGE" || data.type !== "CORTEX_MEMORY_RES" || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", listener);
        resolve(typeof data.briefing === "string" ? data.briefing : "");
      };
      window.addEventListener("message", listener);
      window.postMessage({ source: "CORTEX_INJECTOR", type: "CORTEX_MEMORY_REQ", id, prompt }, window.location.origin);
    });
    cachedBriefing = { key: prompt, text, at: now };
    return text;
  }


  /**
   * Append our block to the last *string* part of the newest user message.
   * Returns a new object (never mutated in place), or null when there is no safe
   * place to put it — an image-first multimodal turn, for instance.
   */
  function appendContext(body, block) {
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) return null;
    const last = messages[messages.length - 1];
    if (!last || (last.author && last.author.role && last.author.role !== "user")) return null;
    const content = last.content;
    if (!content || typeof content !== "object") return null;

    if (!block) return null;

    if (typeof content.parts === "string") {
      return { ...body, messages: [...messages.slice(0, -1), { ...last, content: { ...content, parts: content.parts + block } }] };
    }
    if (!Array.isArray(content.parts)) return null;
    let index = -1;
    for (let i = content.parts.length - 1; i >= 0; i--) {
      if (typeof content.parts[i] === "string") {
        index = i;
        break;
      }
    }
    if (index === -1) return null; // text-less turn (image only): leave it alone
    const parts = content.parts.slice();
    parts[index] = parts[index] + block;
    return { ...body, messages: [...messages.slice(0, -1), { ...last, content: { ...content, parts } }] };
  }

})();
