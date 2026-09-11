/**
 * CORTEX content bridge (ISOLATED world).
 *
 * Responsibilities, in order of how much they matter:
 *  1. never touch the page until the user has accepted the consent card;
 *  2. read user/assistant turns (DOM, plus the page-world hook when enabled) and
 *     hand them to the service worker, deduped;
 *  3. in `composer` mode, insert the memory block where the user can see and edit
 *     it — this extension will not silently rewrite a message on your behalf.
 */
(function () {
  "use strict";

  const H = window.CortexHarvest;
  if (!H) return; // harvest-core.js missing: stay inert rather than half-working

  const state = {
    config: null,
    adapter: H.adapterFor(location.hostname),
    seen: new Set(),
    pending: 0,
    scheduled: 0,
    lastSendAt: 0,
    chip: null,
    consentShown: false,
    injectedThisTurn: false,
  };

  const MIN_SEND_INTERVAL_MS = 1500;

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(response || { ok: false, error: "no response from CORTEX service worker" });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message) });
      }
    });
  }

  // -------------------------------------------------------------------------
  // reading turns
  // -------------------------------------------------------------------------

  function readTurnsFromDom() {
    const adapter = state.adapter;
    if (!adapter || !adapter.turn) return [];
    let nodes;
    try {
      nodes = document.querySelectorAll(adapter.turn);
    } catch (error) {
      return []; // selector broke: degrade to "nothing detected"
    }
    const turns = [];
    for (const node of nodes) {
      if (node.closest && node.closest("[data-cortex-ui]")) continue;
      const role = adapter.authorFromNode
        ? adapter.authorFromNode(node)
        : node.getAttribute(adapter.authorAttr || "data-message-author-role") === "user"
          ? "user"
          : "assistant";
      const text = (node.innerText || node.textContent || "").trim();
      if (text) turns.push({ role, text: H.stripBlock(text) });
    }
    return turns;
  }

  function collect() {
    const turns = readTurnsFromDom();
    if (!turns.length) {
      setStatus("no conversation detected on this page", "idle");
      return;
    }
    const planned = H.planIngest(turns, state.seen, { maxChars: 14000, maxTurns: 40 });
    if (!planned.length) return;
    for (const turn of planned) state.seen.add(turn.key);
    state.pending += planned.length;
    send({ type: "QUEUE_TURNS", turns: planned.map((t) => ({ role: t.role, text: t.text })) })
      .then((response) => {
        state.pending = 0;
        setStatus(`queued ${response.queued ?? planned.length} turn(s)`, response.queued ? "ok" : "idle");
      })
      .catch(() => {
        for (const turn of planned) state.seen.delete(turn.key);
        setStatus("could not reach the CORTEX service worker", "error");
      });
  }

  function scheduleCollect(delay = 300) {
    if (state.scheduled) return;
    state.scheduled = setTimeout(() => {
      state.scheduled = 0;
      const now = Date.now();
      if (now - state.lastSendAt < MIN_SEND_INTERVAL_MS) {
        scheduleCollect(MIN_SEND_INTERVAL_MS - (now - state.lastSendAt));
        return;
      }
      state.lastSendAt = now;
      collect();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // UI: chip + consent
  // -------------------------------------------------------------------------

  const UI_STYLE = "all:initial;position:fixed;z-index:2147483000;font:12px/1.45 ui-sans-serif,system-ui,sans-serif;color:#e9e6ff;";
  const PANEL_STYLE = "background:rgba(12,10,24,.94);border:1px solid rgba(150,120,255,.35);border-radius:12px;padding:10px 12px;box-shadow:0 12px 32px rgba(0,0,0,.45);backdrop-filter:blur(6px);";

  function el(tag, style, textContent) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function button(label, onClick, tone) {
    const node = el("button", `display:inline-block;cursor:pointer;border:1px solid ${tone === "primary" ? "rgba(167,139,250,.7)" : "rgba(148,163,184,.35)"};background:${tone === "primary" ? "rgba(124,58,237,.35)" : "rgba(148,163,184,.12)"};color:#f5f3ff;border-radius:8px;padding:4px 8px;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;`);
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  let statusLine = null;

  function ensureChip() {
    if (state.chip || !state.adapter) return state.chip;
    if (state.config && state.config.hideChip) return null;
    const chip = el("div", `${UI_STYLE}right:16px;bottom:16px;max-width:280px;`);
    chip.setAttribute("data-cortex-ui", "true");
    const panel = el("div", PANEL_STYLE);
    statusLine = el("div", "display:block;margin:0 0 6px;opacity:.9;", "CORTEX: connecting…");
    const actions = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
    actions.append(
      button("Add memory to prompt", () => injectIntoComposer(true), "primary"),
      button("Flush now", () => send({ type: "FLUSH_NOW" }).then((r) => setStatus(r.flushed ? `remembered ${r.report?.triplets ?? 0} fact(s)` : `not flushed: ${r.error || r.reason || "empty"}`)), "ghost"),
      button("Hide", () => {
        chip.remove();
        state.chip = null;
        // Persisted so the chip does not come back every reload; the popup's
        // "Insert into page" button still works without it.
        send({ type: "SET_CONFIG", patch: { hideChip: true } });
      }, "ghost")
    );
    panel.append(statusLine, actions);
    chip.append(panel);
    (document.body || document.documentElement).append(chip);
    state.chip = chip;
    return chip;
  }

  function setStatus(text, tone) {
    if (!statusLine) return;
    statusLine.textContent = `CORTEX: ${text}`;
    statusLine.style.color = tone === "error" ? "#fca5a5" : tone === "ok" ? "#c4b5fd" : "rgba(233,230,255,.75)";
  }

  function showConsent() {
    if (state.consentShown || !state.adapter) return;
    state.consentShown = true;
    const card = el("div", `${UI_STYLE}left:50%;top:16px;transform:translateX(-50%);width:min(520px,92vw);`);
    card.setAttribute("data-cortex-ui", "true");
    const panel = el("div", `${PANEL_STYLE}padding:16px;`);
    panel.append(
      el("strong", "display:block;font-size:13px;margin:0 0 6px;color:#f5f3ff;", "Let CORTEX remember this conversation?"),
      el(
        "p",
        "display:block;margin:0 0 10px;color:rgba(233,230,255,.8);",
        "Nothing is stored until you choose below. Turns are read in this tab and sent to your own core at " +
          (state.coreUrlHint || "http://127.0.0.1:3030") +
          " — never to a CORTEX server. Only your own messages become facts; assistant replies are kept as context. You can pause, inspect and delete anything from the toolbar icon."
      )
    );
    const row = el("div", "display:flex;gap:8px;flex-wrap:wrap;");
    row.append(
      button("Remember only (safest)", () => decide("remember", true), "primary"),
      button("Remember + show memory in my composer", () => decide("composer", true), "ghost"),
      button("Not now", () => decide(null, false), "ghost")
    );
    panel.append(row);
    card.append(panel);
    (document.body || document.documentElement).append(card);
    // Auto-dismiss the nag if ignored, so it is never an interruption loop.
    setTimeout(() => card.remove(), 90000);

    function decide(mode, accept) {
      send({ type: "CONSENT", accept, mode }).then(() => {
        card.remove();
        state.consentShown = true;
        start(accept ? mode : null);
      });
    }
  }

  // -------------------------------------------------------------------------
  // composer injection (visible, undoable)
  // -------------------------------------------------------------------------

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="prompt" i]',
      'div[contenteditable="true"]',
      "textarea",
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.offsetParent !== null) return node;
    }
    return null;
  }

  function insertText(composer, text) {
    composer.focus();
    if (composer.isContentEditable) {
      const selection = window.getSelection();
      let range;
      if (selection && composer.contains(selection.anchorNode)) {
        range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
      } else {
        range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false);
      }
      const inserted = range.createContextualFragment(text);
      const last = inserted.lastChild;
      range.insertNode(inserted);
      if (last) {
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
      }
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    const start = composer.selectionStart ?? composer.value.length;
    const end = composer.selectionEnd ?? composer.value.length;
    const next = composer.value.slice(0, start) + text + composer.value.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (setter && setter.set) setter.set.call(composer, next);
    else composer.value = next;
    composer.setSelectionRange(start + text.length, start + text.length);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  async function injectIntoComposer(manual) {
    if (!state.config || state.config.mode === "remember") {
      setStatus("injection is off — enable it in the CORTEX popup", "error");
      if (manual) notify("CORTEX memory injection is off. Turn on “Insert into composer” in the popup.");
      return { ok: false, error: "mode is remember" };
    }
    const composer = findComposer();
    if (!composer) {
      setStatus("no composer found on this page", "error");
      return { ok: false, error: "no composer" };
    }
    const existing = composer.innerText || composer.value || "";
    if (/\[CORTEX MEMORY/.test(existing)) {
      setStatus("memory is already in the composer", "idle");
      return { ok: true, skipped: "already inserted" };
    }
    const response = await send({ type: "RECALL", prompt: currentQuestion(composer) });
    if (!response.ok) {
      setStatus(response.error || "recall failed", "error");
      return { ok: false, error: response.error };
    }
    const block = H.contextBlock(response.briefing, "composer", (state.config.tokenBudget || 400) * 4);
    if (!block) {
      setStatus("no memory matched this question", "idle");
      if (manual) notify("CORTEX has nothing relevant for this question yet.");
      return { ok: true, empty: true };
    }
    insertText(composer, block);
    setStatus(`inserted ${response.meta?.memories_found ?? 0} memory line(s) — edit or delete freely`, "ok");
    return { ok: true, inserted: block.length };
  }

  function currentQuestion(composer) {
    const text = H.stripBlock(composer.innerText || composer.value || "");
    return text.length > 600 ? text.slice(0, 600) : text;
  }

  function notify(message) {
    const toast = el("div", `${UI_STYLE}left:50%;bottom:88px;transform:translateX(-50%);${PANEL_STYLE}max-width:min(420px,86vw);`);
    toast.setAttribute("data-cortex-ui", "true");
    toast.textContent = message;
    document.documentElement.append(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  // -------------------------------------------------------------------------
  // page-world bridge (request-mode rewrite + richer harvesting)
  // -------------------------------------------------------------------------

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "CORTEX_INJECTOR") return;

    if (data.type === "CORTEX_CONFIG_REQ") {
      window.postMessage(
        {
          source: "CORTEX_BRIDGE",
          type: "CORTEX_CONFIG_RES",
          mode: state.config ? state.config.mode : "remember",
          owner: state.config ? state.config.owner : null,
          budget: state.config ? state.config.tokenBudget : null,
        },
        location.origin
      );
      return;
    }
    if (data.type === "CORTEX_MEMORY_REQ") {
      const response = await send({ type: "RECALL", prompt: data.prompt });
      window.postMessage(
        { source: "CORTEX_BRIDGE", type: "CORTEX_MEMORY_RES", id: data.id, briefing: response.ok ? response.briefing : "" },
        location.origin
      );
      return;
    }
    if (data.type === "CORTEX_TURNS") {
      // The fetch hook saw the real payload: trust it over the DOM.
      const turns = (data.turns || []).filter((t) => t && t.text);
      if (turns.length) {
        const planned = H.planIngest(turns, state.seen, { maxChars: 14000 });
        for (const turn of planned) state.seen.add(turn.key);
        if (planned.length) send({ type: "QUEUE_TURNS", turns: planned });
      }
    }
  });

  // -------------------------------------------------------------------------
  // wiring
  // -------------------------------------------------------------------------

  let observer = null;

  function start() {
    if (!state.adapter) return;
    ensureChip();
    collect();
    if (observer) return;
    observer = new MutationObserver(() => scheduleCollect(300));
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") send({ type: "PAGE_HIDDEN" });
    });
    window.addEventListener("pagehide", () => send({ type: "PAGE_UNLOADED" }), { once: true });
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.type === "INJECT_COMPOSER") {
      injectIntoComposer(true).then(respond);
      return true;
    }
    if (message && message.type === "STATE") applyState(message.state);
    return false;
  });

  document.addEventListener("keydown", (event) => {
    // Alt+Shift+C (the manifest shortcut) puts memory where the user can see it
    // before sending. Not Ctrl+Shift+I: that is DevTools.
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "c") {
      const composer = findComposer();
      if (!composer) return;
      event.preventDefault();
      injectIntoComposer(true);
    }
  });

  async function applyState(next) {
    state.config = next;
    state.coreUrlHint = next.coreUrl;
    if (!state.adapter) return;
    if (!next.consent || !next.consent.acceptedAt) {
      showConsent();
      return;
    }
    if (next.paused) {
      setStatus("paused — nothing is being read", "idle");
      return;
    }
    start();
    setStatus(`remembering into ${next.owner || "cortex://default"}`, "ok");
  }

  send({ type: "GET_STATE" }).then((response) => {
    if (response && response.config) applyState({ ...response.config, paused: response.config.paused });
    else if (response && response.error) setStatus(response.error, "error");
    else applyState({ ...{ consent: null } });
  });

  // Popup/settings changes propagate through the worker; re-pull on focus so the
  // chip reflects a pause the user just toggled.
  window.addEventListener("focus", () => send({ type: "GET_STATE" }).then((r) => r && r.config && applyState(r.config)), true);
})();
