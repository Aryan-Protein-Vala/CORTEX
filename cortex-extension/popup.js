/* CORTEX popup: status, consent, controls and the actual audit trail. */

const $ = (id) => document.getElementById(id);
const H = window.CortexHarvest || null;

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(response || { ok: false, error: "service worker did not answer" });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error && error.message) });
    }
  });
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind || ""}`.trim();
}

async function refreshIntoPopup() {
  const fresh = await send({ type: "CHECK_STATUS" });
  const state = await send({ type: "GET_STATE" });
  renderState({ ...state, status: fresh });
}

function renderState(state) {
  const config = state.config || {};
  $("core-url").textContent = config.coreUrl || "—";
  $("owner").textContent = config.owner || "—";
  $("budget").textContent = `${config.tokenBudget || 400} tk`;
  $("buffered").textContent = String(state.buffered || 0);
  $("consent").hidden = !state.needsConsent;
  $("pause").textContent = config.paused ? "Resume" : "Pause";

  $("set-url").value = config.coreUrl || "";
  $("set-key").value = config.apiKey || "";
  $("set-owner").value = config.owner || "";
  $("set-budget").value = config.tokenBudget || 400;
  $("set-idle").value = Math.round((config.flushIdleMs || 45000) / 1000);
  $("set-mode").value = config.mode || "remember";

  const status = state.status || {};
  if (status.reachable) setStatus(`connected · ${status.text}`, "ok");
  else if (status.kind === "unknown") setStatus("not checked", "idle");
  else setStatus(status.text || "unreachable", status.kind === "auth" ? "warn" : "error");

  renderLog(state.log || []);
}

function renderLog(entries) {
  const list = $("log");
  list.textContent = "";
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "nothing yet — send a message in a supported tab, or store a fact below";
    list.append(empty);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    const when = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const head = document.createElement("div");
    head.className = "row-head";
    const title = document.createElement("strong");
    title.textContent = `${entry.host || "site"} · ${entry.turns || 0} turn(s) → ${entry.triplets ?? 0} fact(s)`;
    const meta = document.createElement("span");
    meta.className = "mono";
    meta.textContent = `${when} · ${entry.reason || "flush"}`;
    head.append(title, meta);
    li.append(head);

    const detail = document.createElement("div");
    detail.className = "micro";
    detail.textContent =
      (entry.newNodes || entry.newEdges
        ? `+${entry.newNodes || 0} nodes · +${entry.newEdges || 0} edges · `
        : "") + `extractor: ${entry.extractor || "unknown"}`;
    li.append(detail);
    if (entry.warnings && entry.warnings.length) {
      const warn = document.createElement("div");
      warn.className = "micro warn";
      warn.textContent = entry.warnings.join(" · ");
      li.append(warn);
    }
    list.append(li);
  }
}

function renderMemories(response) {
  const list = $("memories");
  list.textContent = "";
  const memories = response && response.memories ? response.memories : [];
  if (!memories.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = response && response.error ? response.error : "no memories in this namespace yet";
    list.append(empty);
    return;
  }
  for (const node of memories.slice(0, 12)) {
    const li = document.createElement("li");
    li.className = "memory";
    const label = document.createElement("span");
    label.textContent = node.label;
    const flags = document.createElement("span");
    flags.className = "micro";
    flags.textContent = [
      node.impact >= 9 ? "impact " + node.impact : null,
      node.locked ? "locked" : null,
      node.fading ? "fading" : null,
      node.provenance ? node.provenance : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const controls = document.createElement("span");
    controls.className = "row-actions";

    const lock = document.createElement("button");
    lock.className = "mini";
    lock.textContent = node.locked ? "unlock" : "keep";
    lock.title = node.locked ? "Let decay fade this again" : "Protect this from decay forever";
    lock.addEventListener("click", async () => {
      lock.disabled = true;
      const result = await send({ type: "LOCK", id: node.id, locked: !node.locked });
      setStatus(result.ok ? (node.locked ? "unlocked" : "protected forever") : result.error, result.ok ? "ok" : "error");
      loadMemories();
    });

    const forget = document.createElement("button");
    forget.className = "mini danger";
    forget.textContent = "forget";
    forget.addEventListener("click", async () => {
      forget.disabled = true;
      const result = await send({ type: "FORGET", id: node.id });
      setStatus(result.ok ? `forgot “${node.label}”` : result.error, result.ok ? "ok" : "error");
      loadMemories();
    });

    controls.append(lock, forget);
    li.append(label, flags, controls);
    list.append(li);
  }
}

function loadMemories() {
  return send({ type: "LIST_MEMORIES" }).then(renderMemories);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

document.addEventListener("DOMContentLoaded", async () => {
  const state = await send({ type: "GET_STATE" });
  renderState(state);
  loadMemories();
  const fresh = await send({ type: "CHECK_STATUS" });
  if (fresh) renderState({ ...state, status: fresh });

  $("pause").addEventListener("click", async () => {
    const result = await send({ type: "TOGGLE_PAUSE" });
    setStatus(result.ok ? (result.paused ? "paused" : "running") : result.error, "idle");
    renderState(await send({ type: "GET_STATE" }));
  });

  $("flush").addEventListener("click", async () => {
    const button = $("flush");
    button.disabled = true;
    button.textContent = "Extracting…";
    const result = await send({ type: "FLUSH_NOW" });
    if (result.flushed) {
      const report = result.report || {};
      $("store-result").textContent = `stored ${report.triplets ?? 0} fact(s)`;
      setStatus(`remembered ${report.triplets ?? 0} fact(s)`, "ok");
    } else {
      setStatus(result.error || "nothing buffered to remember", "warn");
    }
    button.disabled = false;
    button.textContent = "Remember now";
    renderState(await send({ type: "GET_STATE" }));
    loadMemories();
  });

  $("inject").addEventListener("click", async () => {
    const tabId = await activeTabId();
    if (!tabId) return setStatus("no active tab", "error");
    const result = await send({ type: "INJECT_CLICK", tabId });
    if (result && result.ok) setStatus("memory inserted — you can edit it before sending", "ok");
    else setStatus((result && result.error) || "no composer found there", "warn");
  });

  $("store").addEventListener("click", async () => {
    const fact = $("fact").value.trim();
    if (!fact) return ($("store-result").textContent = "type something first");
    $("store").disabled = true;
    $("store-result").textContent = "storing…";
    const result = await send({ type: "STORE_FACT", fact });
    $("store").disabled = false;
    if (result.ok && result.triplets > 0) {
      $("store-result").textContent = `stored ${result.triplets} fact(s)`;
      $("fact").value = "";
      loadMemories();
    } else if (result.ok) {
      $("store-result").textContent = "nothing durable found — say it as one atomic fact";
    } else {
      $("store-result").textContent = result.error || "failed";
    }
    renderState(await send({ type: "GET_STATE" }));
  });

  $("refresh-memories").addEventListener("click", loadMemories);

  $("consent-accept").addEventListener("click", async () => {
    await send({ type: "CONSENT", accept: true, mode: $("consent-mode").value });
    renderState(await send({ type: "GET_STATE" }));
    setStatus("CORTEX is now reading this tab", "ok");
  });
  $("consent-decline").addEventListener("click", async () => {
    await send({ type: "CONSENT", accept: false });
    renderState(await send({ type: "GET_STATE" }));
    setStatus("paused until you turn it on", "idle");
  });

  $("save").addEventListener("click", async () => {
    const patch = {
      coreUrl: $("set-url").value.trim(),
      apiKey: $("set-key").value.trim(),
      owner: $("set-owner").value.trim(),
      tokenBudget: Number($("set-budget").value),
      flushIdleMs: Number($("set-idle").value) * 1000,
      mode: $("set-mode").value,
    };
    const result = await send({ type: "SET_CONFIG", patch });
    $("settings-result").textContent = result.error || "saved";
    if (!result.error) {
      await refreshIntoPopup();
    }
    setTimeout(() => ($("settings-result").textContent = ""), 2600);
  });

  $("test").addEventListener("click", async () => {
    $("settings-result").textContent = "testing…";
    const fresh = await send({ type: "CHECK_STATUS" });
    $("settings-result").textContent = fresh.reachable ? `ok in ${fresh.latencyMs ?? 0}ms` : fresh.text || "unreachable";
    renderState({ ...(await send({ type: "GET_STATE" })), status: fresh });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "STATE_CHANGED") {
      send({ type: "GET_STATE" }).then(renderState);
    }
    return false;
  });

  // Enter in the fact box stores it, because re-typing is how people give up.
  $("fact").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) $("store").click();
  });
});
