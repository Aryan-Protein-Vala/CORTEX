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
