// Service Worker background script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_MEMORY") {
    // Call the local Rust Cortex Core API
    fetch("http://localhost:3030/v1/recall", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_id: "default_user",
        prompt: "fetch_context",
        token_budget: 500
      })
    })
    .then(res => res.json())
    .then(data => {
      sendResponse(data);
    })
    .catch(err => {
      console.error("Cortex API unreachable. Is the Rust engine running?", err);
      sendResponse(null);
    });

    return true; // Indicates async response
  }
});
