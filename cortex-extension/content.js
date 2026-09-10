// Runs in ISOLATED world - Bridge between MAIN world and Background Service Worker

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!event.data || typeof event.data !== 'object' || event.data.source !== 'CORTEX_INJECTOR') return;

  if (event.data.type === 'CORTEX_MEMORY_REQ') {
    const { id, prompt } = event.data;

    chrome.runtime.sendMessage({ type: "FETCH_MEMORY", prompt }, (response) => {
      window.postMessage({
        source: 'CORTEX_BRIDGE',
        type: 'CORTEX_MEMORY_RES',
        id,
        briefing: response ? response.briefing : null
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

// Auto-Ingest AI Responses via DOM Observation
let observing = false;
let lastIngestedText = "";

function startObserver() {
  if (observing) return;
  const observer = new MutationObserver((mutations) => {
    // Basic ChatGPT DOM observation
    const turnElements = document.querySelectorAll('div[data-message-author-role="assistant"]');
    if (turnElements.length > 0) {
      const lastTurn = turnElements[turnElements.length - 1];
      
      // Check if it's done generating. Usually the stop button disappears or a specific class changes.
      // A simple heuristic: if a response has settled for a moment without changing, or we detect the "Copy" button.
      const isStreaming = lastTurn.classList.contains('result-streaming') || document.querySelector('button[aria-label="Stop generating"]');
      
      if (!isStreaming) {
        const text = lastTurn.textContent || lastTurn.innerText;
        if (text && text.trim().length > 10 && text !== lastIngestedText) {
          lastIngestedText = text;
          chrome.runtime.sendMessage({
            type: "INGEST_CONVERSATION",
            prompt: "[AI Response]: " + text
          });
          console.log("🧠 [CORTEX] Auto-ingested AI response");
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observing = true;
}

// Start observing after a slight delay to let the app load
setTimeout(startObserver, 2000);
