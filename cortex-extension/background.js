/**
 * CORTEX service worker: config, consent gate, buffered harvest, flush, badge.
 *
 * The extension never talks to anything but the user's own core, and it never
 * sends a byte until the user has accepted the consent card. Turns are buffered
 * per tab and extracted once per idle window (that is the whole cost argument),
 * so nothing here may "helpfully" fire a request on every mutation.
 */
importScripts("harvest-core.js");

const H = globalThis.CortexHarvest;

const DEFAULTS = {
  coreUrl: "http://127.0.0.1:3030",
  apiKey: "",
  owner: "cortex://default",
  tokenBudget: 400,
  // remember: read-only harvesting (safe default)
  // composer: also let the user drop a memory block into the input, visibly
  // request:  also rewrite the outgoing request (experimental, off unless chosen)
  mode: "remember",
  paused: false,
  consent: null, // { acceptedAt, mode } | { declinedAt }
  flushIdleMs: 45000,
};

let config = { ...DEFAULTS };
const buffers = new Map(); // tabId -> { host, turns: [], keys: Set, lastActivity, failing, attempts }
const log = []; // last stored batches, newest first — the popup shows this verbatim
let lastStatus = { reachable: false, kind: "unknown", text: "not checked yet", checkedAt: 0 };

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

async function load() {
  const stored = await chrome.storage.local.get(["cortexConfig", "cortexLog"]);
  config = { ...DEFAULTS, ...(stored.cortexConfig || {}) };
  if (Array.isArray(stored.cortexLog)) log.push(...stored.cortexLog.slice(-12));
  return config;
}

async function save() {
  await chrome.storage.local.set({ cortexConfig: config, cortexLog: log.slice(-12) });
}

function broadcast() {
  chrome.runtime.sendMessage({ type: "STATE_CHANGED" }).catch(() => {});
}

function readyToHarvest() {
  return !!config.consent && !!config.consent.acceptedAt && !config.paused;
}

// ---------------------------------------------------------------------------
// core client
// ---------------------------------------------------------------------------

async function core(pathname, { method = "POST", body, timeout = 12000 } = {}) {
  const url = config.coreUrl.replace(/\/+$/, "") + pathname;
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (config.apiKey) headers["x-cortex-key"] = config.apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers,
      credentials: "omit",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      const err = new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
      err.status = response.status;
      err.code = payload && payload.error && payload.error.code;
      throw err;
    }
    return payload || {};
  } finally {
    clearTimeout(timer);
  }
}

async function refreshStatus() {
  const startedAt = Date.now();
  try {
    const health = await core("/health", { method: "GET", timeout: 4000 });
    lastStatus = {
      reachable: true,
      kind: "ok",
      text: `${health.backend || "core"} · ${health.nodes ?? 0} memories`,
      latencyMs: Date.now() - startedAt,
      health,
      checkedAt: Date.now(),
    };
  } catch (error) {
    lastStatus = {
      reachable: false,
      ...shape(H.classifyError(error, error.status, error.code)),
      checkedAt: Date.now(),
    };
  }
  updateBadge();
  return lastStatus;
}

function shape({ kind, text }) {
  return { kind, text };
}

function updateBadge() {
  let pending = 0;
  for (const buffer of buffers.values()) pending += buffer.turns.length;
  const failing = [...buffers.values()].some((b) => b.failing);
  const title = config.paused ? "⏸" : failing ? "!" : pending ? String(pending) : "";
  chrome.action.setBadgeText({ text: title }).catch(() => {});
  chrome.action
    .setBadgeBackgroundColor({ color: failing ? "#b91c1c" : config.paused ? "#6b7280" : "#7c3aed" })
    .catch(() => {});
  chrome.action
    .setTitle({
      title: config.paused
        ? "CORTEX — paused"
        : failing
          ? "CORTEX — the core rejected the last send (open the popup)"
          : `CORTEX — ${pending} turn(s) waiting to be remembered`,
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// buffering + flush
// ---------------------------------------------------------------------------

function bufferFor(tabId, host) {
  let buffer = buffers.get(tabId);
  if (!buffer) {
    buffer = { host, turns: [], keys: new Set(), lastActivity: Date.now(), failing: false, attempts: 0 };
    buffers.set(tabId, buffer);
  }
  return buffer;
}

async function queueTurns(tabId, host, turns) {
  if (!readyToHarvest()) return { queued: 0, reason: config.consent ? "paused" : "consent" };
  const buffer = bufferFor(tabId, host);
  const planned = H.planIngest(turns, buffer.keys, { maxChars: 14000, maxTurns: 40 });
  for (const turn of planned) {
    buffer.turns.push({ role: turn.role, content: turn.text });
    buffer.keys.add(turn.key);
  }
  buffer.lastActivity = Date.now();
  updateBadge();
  if (buffer.turns.length >= 30) await flush(tabId, "full");
  return { queued: planned.length, buffered: buffer.turns.length };
}

async function flush(tabId, reason) {
  const buffer = buffers.get(tabId);
  if (!buffer || !buffer.turns.length) return { flushed: false, reason: "empty" };
  const session = H.sessionKey(tabId, buffer.host);
  const turns = buffer.turns.splice(0, buffer.turns.length);
  try {
    for (const turn of turns) {
      await core("/v1/session/message", {
        body: { session_id: session, role: turn.role, content: turn.text, owner: config.owner, source: "extension" },
        timeout: 8000,
      });
    }
    const flushed = await core("/v1/flush", { body: { session_id: session }, timeout: 30000 });
    const report = (flushed.results || [])[0] || {};
    const summary = H.summarizeStored(report);
    buffer.failing = false;
    buffer.attempts = 0;
    log.unshift({
      at: new Date().toISOString(),
      host: buffer.host,
      turns: turns.length,
      reason,
      ...summary,
      labels: (report.labels || undefined),
    });
    if (log.length > 12) log.length = 12;
    lastStatus = { ...lastStatus, reachable: true, kind: "ok", text: `remembered ${summary.triplets} fact(s)` };
    await save();
    return { flushed: true, report: summary };
  } catch (error) {
    // Put the turns back so a transient core failure never loses the user's text.
    buffer.turns.unshift(...turns);
    buffer.failing = true;
    buffer.attempts += 1;
    const failure = H.classifyError(error, error.status, error.code);
    lastStatus = { reachable: false, kind: failure.kind, text: failure.text, checkedAt: Date.now() };
    await save();
    return { flushed: false, error: failure.text };
  } finally {
    updateBadge();
    broadcast();
  }
}

async function flushIdle() {
  const now = Date.now();
  for (const [tabId, buffer] of buffers) {
    if (buffer.turns.length && now - buffer.lastActivity > config.flushIdleMs) await flush(tabId, "idle");
    else if (buffer.failing && buffer.attempts < 5) await flush(tabId, "retry");
    else if (buffer.failing) {
      buffers.delete(tabId); // stop hammering a core that keeps rejecting us
      lastStatus = { ...lastStatus, text: "gave up after 5 failed sends — open the popup to inspect" };
    }
  }
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await load();
  chrome.alarms.create("cortex-flush", { periodInMinutes: 1 });
  if (reason === "install") {
    chrome.storage.local.set({ cortexNeedsConsent: true });
  }
  refreshStatus();
});

chrome.runtime.onStartup.addListener(async () => {
  await load();
  chrome.alarms.create("cortex-flush", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cortex-flush") flushIdle();
});

// Keyboard shortcut (Alt+Shift+C) from the manifest: inject into the active tab.
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "cortex-inject") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "INJECT_COMPOSER" });
  } catch (error) {
    // No notifications permission (deliberately): the badge is the feedback channel.
    chrome.action.setBadgeText({ text: "—" }).catch(() => {});
    chrome.action.setTitle({ title: "CORTEX — no supported chat tab is focused" }).catch(() => {});
    setTimeout(updateBadge, 1800);
  }
});

// Flush on navigation instead of letting a tab close with the conversation lost.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (buffers.has(tabId)) flush(tabId, "tab-closed").then(() => buffers.delete(tabId));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id !== undefined ? sender.tab.id : -1;
  const host = sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : "popup";

  (async () => {
    switch (message && message.type) {
      case "GET_STATE": {
        const needsConsent = !config.consent || !config.consent.acceptedAt;
        sendResponse({
          config,
          status: lastStatus,
          needsConsent,
          log: log.slice(0, 8),
          buffered: (buffers.get(tabId) || {}).turns?.length || 0,
        });
        return;
      }
      case "SET_CONFIG": {
        const patch = message.patch || {};
        if (patch.coreUrl) {
          const url = String(patch.coreUrl).trim().replace(/\/+$/, "");
          let parsed;
          try {
            parsed = new URL(url);
          } catch {
            return sendResponse({ error: "coreUrl is not a valid http(s) URL" });
          }
          if (!/^https?:$/.test(parsed.protocol)) return sendResponse({ error: "coreUrl must be http(s)" });
          patch.coreUrl = url;
        }
        if (patch.owner) patch.owner = String(patch.owner).trim() || DEFAULTS.owner;
        if (patch.tokenBudget) patch.tokenBudget = Math.min(4000, Math.max(32, Number(patch.tokenBudget) || 400));
        if (patch.mode && !["remember", "composer", "request"].includes(patch.mode)) delete patch.mode;
        config = { ...config, ...patch };
        await save();
        updateBadge();
        broadcast();
        sendResponse({ ok: true, config });
        return;
      }
      case "CONSENT": {
        config.consent = message.accept
          ? { acceptedAt: new Date().toISOString(), mode: message.mode || "remember" }
          : { declinedAt: new Date().toISOString() };
        if (message.accept && message.mode) config.mode = message.mode;
        if (!message.accept) {
          buffers.clear();
          config.paused = true;
        }
        await save();
        updateBadge();
        broadcast();
        sendResponse({ ok: true, config });
        return;
      }
      case "QUEUE_TURNS": {
        sendResponse(await queueTurns(tabId, host, message.turns || []));
        return;
      }
      case "PAGE_HIDDEN": {
        // The tab is going away: extract now rather than losing the tail.
        sendResponse(await flush(tabId, "hidden"));
        return;
      }
      case "PAGE_UNLOADED": {
        sendResponse(await flush(tabId, "unload"));
        buffers.delete(tabId);
        return;
      }
      case "RECALL": {
        try {
          const data = await core("/v1/recall", {
            body: { prompt: message.prompt || "", owner: config.owner, token_budget: config.tokenBudget, explain: !!message.explain },
            timeout: 20000,
          });
          sendResponse({ ok: true, briefing: data.briefing || "", meta: { memories_found: data.memories_found, tokens_used: data.tokens_used, truncated: data.truncated } });
        } catch (error) {
          const failure = H.classifyError(error, error.status, error.code);
          lastStatus = { reachable: false, ...failure, checkedAt: Date.now() };
          updateBadge();
          sendResponse({ ok: false, error: failure.text });
        }
        return;
      }
      case "FLUSH_NOW": {
        sendResponse(await flush(tabId, "manual"));
        return;
      }
      case "CHECK_STATUS": {
        sendResponse(await refreshStatus());
        return;
      }
      case "STORE_FACT": {
        try {
          const data = await core("/v1/ingest", {
            body: { owner: config.owner, prompt: `USER: ${message.fact}`, source: "extension", wait: true },
            timeout: 30000,
          });
          const summary = H.summarizeStored(data.result);
          log.unshift({ at: new Date().toISOString(), host: "manual", turns: 1, reason: "explicit", ...summary });
          await save();
          broadcast();
          sendResponse({ ok: true, ...summary });
        } catch (error) {
          sendResponse({ ok: false, error: H.classifyError(error, error.status, error.code).text });
        }
        return;
      }
      case "LIST_MEMORIES": {
        try {
          const data = await core("/v1/memories", { method: "GET", timeout: 8000 });
          sendResponse({ ok: true, memories: data.memories || [], owner_uri: data.owner_uri });
        } catch (error) {
          sendResponse({ ok: false, error: H.classifyError(error, error.status, error.code).text });
        }
        return;
      }
      case "LOCK": {
        try {
          const result = await core(`/v1/memories/${encodeURIComponent(message.id)}/lock`, {
            body: { locked: message.locked !== false },
            timeout: 8000,
          });
          sendResponse({ ok: true, locked: result.locked });
        } catch (error) {
          sendResponse({ ok: false, error: H.classifyError(error, error.status, error.code).text });
        }
        return;
      }
      case "FORGET": {
        try {
          await core(`/v1/memories/${encodeURIComponent(message.id)}`, { method: "DELETE", timeout: 8000 });
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: H.classifyError(error, error.status, error.code).text });
        }
        return;
      }
      case "TOGGLE_PAUSE": {
        config.paused = !config.paused;
        if (config.paused) {
          for (const [tabId] of [...buffers.keys()]) await flush(tabId, "paused");
        }
        await save();
        updateBadge();
        broadcast();
        sendResponse({ ok: true, paused: config.paused });
        return;
      }
      case "INJECT_CLICK": {
        // Popup/keyboard asked for memory in the active tab's composer.
        sendResponse(await chrome.tabs.sendMessage(message.tabId, { type: "INJECT_COMPOSER" }).catch((e) => ({ ok: false, error: String(e) })));
        return;
      }
      default:
        sendResponse({ error: `unknown message type ${message && message.type}` });
    }
  })().catch((error) => sendResponse({ ok: false, error: String(error && error.message) }));

  return true; // async
});

load().then(() => refreshStatus());
