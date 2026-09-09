// This script runs in an isolated world. To intercept fetch, we must inject a script into the MAIN world.

const injectionCode = `
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    let [resource, config] = args;
    
    // We only want to intercept the specific API calls that send chat messages
    const isChatGPT = typeof resource === 'string' && resource.includes('/backend-api/conversation');
    const isClaude = typeof resource === 'string' && resource.includes('/api/append_message');

    if ((isChatGPT || isClaude) && config && config.body) {
      try {
        let bodyObj = JSON.parse(config.body);
        
        // 1. Send a quick message to our Background Script to fetch the Cortex memory
        // Since we are in the main world, we can't use chrome.runtime directly easily,
        // so we dispatch a custom event that the content script will catch.
        
        const eventId = Math.random().toString(36).substring(7);
        
        const memoryPromise = new Promise((resolve) => {
          const listener = (event) => {
            if (event.detail.id === eventId) {
              window.removeEventListener('CortexMemoryResponse', listener);
              resolve(event.detail.memory);
            }
          };
          window.addEventListener('CortexMemoryResponse', listener);
        });

        // Tell the isolated content script to get memory
        window.dispatchEvent(new CustomEvent('CortexFetchMemory', { detail: { id: eventId } }));

        // Wait for the memory payload (Max 200ms to avoid UX lag)
        const memoryPayload = await Promise.race([
          memoryPromise,
          new Promise(r => setTimeout(() => r(null), 200)) // 200ms timeout fallback
        ]);

        if (memoryPayload) {
          // 2. Inject the memory into the outgoing prompt payload
          console.log("🧠 [CORTEX] Injecting Hive Mind Context:", memoryPayload);
          
          if (isChatGPT && bodyObj.messages) {
            // Find the user's latest message and append the context invisibly
            const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
            if (lastMsg && lastMsg.content && lastMsg.content.parts) {
              lastMsg.content.parts[0] += "\\n\\n[SYSTEM CORTEX CONTEXT: " + memoryPayload + "]";
            }
          } else if (isClaude && bodyObj.prompt) {
            bodyObj.prompt += "\\n\\n[SYSTEM CORTEX CONTEXT: " + memoryPayload + "]";
          }
          
          // Re-serialize the modified body
          config.body = JSON.stringify(bodyObj);
        }
      } catch (e) {
        console.error("🧠 [CORTEX] Interception failed:", e);
      }
    }
    
    // Proceed with the actual fetch
    return originalFetch(resource, config);
  };
})();
`;

// Inject the patch into the actual page DOM
const script = document.createElement('script');
script.textContent = injectionCode;
(document.head || document.documentElement).appendChild(script);
script.remove();

// Listen for the custom event from the main world, forward to background.js, and send response back
window.addEventListener('CortexFetchMemory', (e) => {
  const eventId = e.detail.id;
  
  chrome.runtime.sendMessage({ type: "FETCH_MEMORY" }, (response) => {
    window.dispatchEvent(new CustomEvent('CortexMemoryResponse', { 
      detail: { 
        id: eventId, 
        memory: response ? response.briefing : null 
      } 
    }));
  });
});

console.log("🧠 [CORTEX] Extension loaded. Waiting to intercept prompts.");
