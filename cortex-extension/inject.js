// Runs in MAIN world - hooks into window.fetch without inline script tags or CSP violations

(function() {
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    let [resource, config] = args;
    const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

    const isChatGPT = url.includes('/backend-api/conversation');
    const isClaude = url.includes('/api/append_message') || url.includes('/api/organizations/') && url.includes('/chat_conversations');

    if ((isChatGPT || isClaude) && config && config.body) {
      try {
        let bodyObj = typeof config.body === 'string' ? JSON.parse(config.body) : config.body;
        let promptText = "";

        if (isChatGPT && bodyObj.messages && bodyObj.messages.length > 0) {
          const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
          if (lastMsg && lastMsg.content && Array.isArray(lastMsg.content.parts)) {
            promptText = lastMsg.content.parts[0] || "";
          }
        } else if (isClaude && bodyObj.prompt) {
          promptText = bodyObj.prompt;
        }

        if (promptText) {
          const eventId = Math.random().toString(36).substring(7);

          // Request memory briefing from isolated content bridge
          const memoryPayload = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              window.removeEventListener('message', listener);
              resolve(null);
            }, 600); // 600ms responsive ceiling

            const listener = (event) => {
              if (event.source === window && event.origin === window.location.origin && event.data && event.data.type === 'CORTEX_MEMORY_RES' && event.data.id === eventId) {
                clearTimeout(timeout);
                window.removeEventListener('message', listener);
                resolve(event.data.briefing);
              }
            };

            window.addEventListener('message', listener);
            window.postMessage({ source: 'CORTEX_INJECTOR', type: 'CORTEX_MEMORY_REQ', id: eventId, prompt: promptText }, window.location.origin);
          });

          if (memoryPayload && memoryPayload !== "{}") {
            let formattedBriefing = "";
            try {
              const parsed = typeof memoryPayload === 'string' ? JSON.parse(memoryPayload) : memoryPayload;
              if (parsed.context && typeof parsed.context === 'string' && !parsed.context.includes("No prior")) {
                formattedBriefing = parsed.context;
              } else if (parsed.briefing && typeof parsed.briefing === 'string') {
                formattedBriefing = parsed.briefing;
              }
            } catch {
              formattedBriefing = String(memoryPayload);
            }

            if (formattedBriefing) {
              console.log("🧠 [CORTEX] Injected Hive Mind Memory Context:", formattedBriefing);
              const injection = `[SYSTEM CORTEX CONTEXT:\n${formattedBriefing}\n]\n\n`;

              if (isChatGPT && bodyObj.messages) {
                const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
                if (lastMsg && lastMsg.content && lastMsg.content.parts) {
                  lastMsg.content.parts[0] = `${injection}${lastMsg.content.parts[0]}`;
                }
              } else if (isClaude && bodyObj.prompt) {
                bodyObj.prompt = `${injection}${bodyObj.prompt}`;
              }

              config.body = JSON.stringify(bodyObj);
            }
          }
        }
      } catch (err) {
        console.warn("🧠 [CORTEX] Interception pass-through due to error:", err);
      }
    }

    const response = await originalFetch(resource, config);

    // Two-way sync: Ingest conversation turns so Cortex continues to learn
    if ((isChatGPT || isClaude) && config && config.body) {
      try {
        let bodyObj = typeof config.body === 'string' ? JSON.parse(config.body) : config.body;
        let promptText = "";
        if (isChatGPT && bodyObj.messages && bodyObj.messages.length > 0) {
          const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
          if (lastMsg && lastMsg.content && Array.isArray(lastMsg.content.parts)) {
            promptText = lastMsg.content.parts[0] || "";
          }
        } else if (isClaude && bodyObj.prompt) {
          promptText = bodyObj.prompt;
        }

        if (promptText) {
          // Strip system cortex context prefix before ingesting into memory
          const cleanPrompt = promptText.replace(/\[SYSTEM CORTEX CONTEXT:[\s\S]*?\]\n\n/, '');
          window.postMessage({
            source: 'CORTEX_INJECTOR',
            type: 'CORTEX_INGEST_REQ',
            prompt: cleanPrompt
          }, window.location.origin);
        }
      } catch {
        // Silently pass
      }
    }

    return response;
  };

  console.log("🧠 [CORTEX] Injector active in MAIN world.");
})();
