// Runs in ISOLATED world - Bridge between MAIN world and Background Service Worker

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!event.data || typeof event.data !== 'object' || event.data.source !== 'CORTEX_INJECTOR') return;

  if (event.data.type === 'CORTEX_MEMORY_REQ') {
    const { id, prompt } = event.data;

    chrome.runtime.sendMessage({ type: "FETCH_MEMORY", prompt }, (response) => {
      const briefing = response ? (response.briefing || response.context || null) : null;
      window.postMessage({
        source: 'CORTEX_BRIDGE',
        type: 'CORTEX_MEMORY_RES',
        id,
        briefing
      }, window.location.origin);
    });
  } else if (event.data.type === 'CORTEX_INGEST_REQ') {
    chrome.runtime.sendMessage({
      type: "INGEST_CONVERSATION",
      prompt: event.data.prompt
    });
  }
});

console.log("🧠 [CORTEX] Bridge loaded in isolated world.");

// Performance-optimized, debounced DOM observer for ChatGPT/Claude completion
let observing = false;
let debounceTimer = null;
let lastIngestedHash = "";

function computeSimpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

function handleDomSettled() {
  // Check if assistant response ingestion is explicitly enabled in user settings
  chrome.storage.local.get(["ingest_assistant_responses", "cortex_enabled"], (items) => {
    if (items.cortex_enabled === false || !items.ingest_assistant_responses) {
      return; // Disabled by default to protect memory graph integrity (§3.3)
    }

    const assistantTurns = document.querySelectorAll('div[data-message-author-role="assistant"]');
    if (!assistantTurns || assistantTurns.length === 0) return;

    const lastTurn = assistantTurns[assistantTurns.length - 1];
    const isStreaming = lastTurn.classList.contains('result-streaming') || document.querySelector('button[aria-label="Stop generating"]');
    if (isStreaming) return;

    const text = (lastTurn.textContent || lastTurn.innerText || "").trim();
    if (text.length < 20) return;

    const hash = computeSimpleHash(text);
    if (hash === lastIngestedHash) return;
    lastIngestedHash = hash;

    // Truncate to avoid massive token bloat
    const cleanSample = text.slice(0, 1000);
    chrome.runtime.sendMessage({
      type: "INGEST_CONVERSATION",
      prompt: `[Assistant Output Context]: ${cleanSample}`
    });
    console.log("🧠 [CORTEX] Ingested verified assistant context.");
  });
}

function startObserver() {
  if (observing) return;
  const target = document.querySelector('main') || document.body;
  if (!target) return;

  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    // 1500ms debounce ensures the DOM has completely settled after streaming
    debounceTimer = setTimeout(handleDomSettled, 1500);
  });

  // Observe childList changes only — not characterData on every single stroke
  observer.observe(target, { childList: true, subtree: true });
  observing = true;
}

// Start observer after initial load
if (document.readyState === 'complete') {
  startObserver();
} else {
  window.addEventListener('load', startObserver);
}
