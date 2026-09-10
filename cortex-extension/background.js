// Service Worker background script

// Service Worker background script
const DEFAULT_URL = "http://127.0.0.1:3030";

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["cortex_url", "cortex_user_id", "cortex_enabled"], (items) => {
      resolve({
        url: items.cortex_url || DEFAULT_URL,
        userId: items.cortex_user_id || "default_user",
        enabled: items.cortex_enabled !== false
      });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_MEMORY") {
    getConfig().then(({ url, userId, enabled }) => {
      if (!enabled) {
        sendResponse(null);
        return;
      }
      fetch(`${url}/v1/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          prompt: request.prompt || "general_context",
          token_budget: 500
        }),
        signal: AbortSignal.timeout(2500)
      })
      .then(res => res.ok ? res.json() : null)
      .then(data => sendResponse(data))
      .catch(err => {
        console.warn("Cortex API recall failed:", err);
        sendResponse(null);
      });
    });
    return true; // async
  }

  if (request.type === "INGEST_CONVERSATION") {
    getConfig().then(({ url, userId, enabled }) => {
      if (!enabled) {
        sendResponse({ success: false, reason: "disabled" });
        return;
      }
      fetch(`${url}/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          prompt: request.prompt
        }),
        signal: AbortSignal.timeout(5000)
      })
      .then(res => res.ok ? res.json() : { success: false })
      .then(data => sendResponse(data))
      .catch(err => {
        console.warn("Cortex Ingest failed:", err);
        sendResponse({ success: false });
      });
    });
    return true; // async
  }

  if (request.type === "CHECK_STATUS") {
    getConfig().then(({ url, enabled }) => {
      const start = Date.now();
      fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
        .then(res => res.json())
        .then(data => {
          const latency = Date.now() - start;
          sendResponse({ connected: true, latency, data, enabled });
        })
        .catch(() => {
          sendResponse({ connected: false, latency: 0, enabled });
        });
    });
    return true;
  }

  if (request.type === "FORCE_SYNC") {
    getConfig().then(({ url }) => {
      fetch(`${url}/v1/sweep`, { method: "POST", signal: AbortSignal.timeout(5000) })
        .then(res => res.json())
        .then(data => sendResponse(data))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});
