// Service Worker background script

const CORTEX_CORE_URL = "http://localhost:3030";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_MEMORY") {
    fetch(`${CORTEX_CORE_URL}/v1/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "default_user",
        prompt: request.prompt || "general_context",
        token_budget: 500
      })
    })
    .then(res => res.json())
    .then(data => sendResponse(data))
    .catch(err => {
      console.warn("Cortex API unreachable. Is the Rust engine running?", err);
      sendResponse(null);
    });

    return true; // Indicates async response
  }

  if (request.type === "INGEST_CONVERSATION") {
    fetch(`${CORTEX_CORE_URL}/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "default_user",
        prompt: request.prompt
      })
    })
    .then(res => res.json())
    .then(data => sendResponse(data))
    .catch(err => {
      console.warn("Cortex Ingest failed:", err);
      sendResponse({ success: false });
    });

    return true;
  }

  if (request.type === "CHECK_STATUS") {
    const start = Date.now();
    fetch(`${CORTEX_CORE_URL}/health`)
      .then(res => res.json())
      .then(data => {
        const latency = Date.now() - start;
        sendResponse({ connected: true, latency, data });
      })
      .catch(() => {
        sendResponse({ connected: false, latency: 0 });
      });

    return true;
  }

  if (request.type === "FORCE_SYNC") {
    fetch(`${CORTEX_CORE_URL}/v1/sweep`, { method: "POST" })
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }
});
