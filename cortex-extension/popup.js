document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status-indicator');
  const latencyEl = document.getElementById('latency-val');
  const syncBtn = document.getElementById('sync-btn');
  const toggleInput = document.getElementById('cortex-toggle');

  // Load saved toggle state
  chrome.storage.local.get(["cortex_enabled"], (items) => {
    if (toggleInput) {
      toggleInput.checked = items.cortex_enabled !== false;
    }
  });

  if (toggleInput) {
    toggleInput.addEventListener('change', (e) => {
      chrome.storage.local.set({ cortex_enabled: e.target.checked });
    });
  }

  // Check connection status to Cortex Core
  chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (res) => {
    if (res && res.connected) {
      statusEl.textContent = '● CORE CONNECTED';
      statusEl.className = 'status connected';
      latencyEl.textContent = `${res.latency}ms`;
    } else {
      statusEl.textContent = '○ CORE OFFLINE';
      statusEl.className = 'status offline';
      latencyEl.textContent = 'offline';
    }
  });

  // Wire sync button
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';

      chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (res) => {
        syncBtn.disabled = false;
        if (res && res.success) {
          syncBtn.textContent = `Synced (${res.pruned_items} pruned)`;
        } else {
          syncBtn.textContent = 'Sync Complete';
        }
        setTimeout(() => {
          syncBtn.textContent = 'Force Sync Memory';
        }, 2000);
      });
    });
  }
});
