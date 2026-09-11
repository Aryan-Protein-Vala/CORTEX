/**
 * CORTEX desktop window logic.
 *
 * No bundler, no framework: `frontendDist` serves these three files as they are.
 * Every core call goes through a Rust command (`invoke`), so the webview never
 * learns the API key and the CSP never has to allow a remote origin.
 */

const tauri = window.__TAURI__ ?? {};
const invoke = tauri.core?.invoke ?? tauri.invoke;
const listen = tauri.event?.listen ?? (async () => () => {});

const el = (id) => document.getElementById(id);
const status = el("status");
const list = el("memories");

function setStatus(text, kind) {
  status.textContent = text;
  status.className = `pill ${kind}`;
}

function showError(node, message) {
  node.hidden = false;
  node.textContent = message;
  node.classList.add("err");
}

function showResult(node, message) {
  node.hidden = false;
  node.textContent = message;
  node.classList.remove("err");
}

async function call(command, args) {
  if (typeof invoke !== "function") {
    throw new Error("this window is not running inside Tauri, so it cannot reach the core");
  }
  return invoke(command, args);
}

function retention(node) {
  const value = Number(node.retention ?? 1);
  return Number.isFinite(value) ? value : 1;
}

function renderMemories(payload) {
  list.textContent = "";
  const memories = payload?.memories ?? [];
  el("count").textContent = `${payload?.returned ?? memories.length} of ${payload?.total ?? memories.length} shown · ${payload?.owner_uri ?? ""}`;

  if (!memories.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Nothing stored under this namespace yet. Write one fact above and hit Reload.";
    list.append(empty);
    return;
  }

  for (const node of memories) {
    const item = document.createElement("li");
    item.className = "memory";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.label;

    const meta = document.createElement("span");
    meta.className = "meta mono";
    const flags = [
      `impact ${node.impact ?? 0}`,
      `R ${(retention(node) * 100).toFixed(0)}%`,
      node.locked ? "locked" : null,
      node.fading ? "fading" : null,
      node.provenance || null,
    ].filter(Boolean);
    meta.textContent = flags.join(" · ");

    const controls = document.createElement("span");
    controls.className = "controls";

    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "ghost";
    lock.textContent = node.locked ? "unlock" : "keep";
    lock.title = node.locked
      ? "Let the forgetting curve fade this again"
      : "Protect this from decay forever";
    lock.addEventListener("click", async () => {
      lock.disabled = true;
      try {
        await call("core_lock", { nodeId: node.id, locked: !node.locked });
        await loadMemories();
      } catch (error) {
        setStatus(String(error), "down");
      } finally {
        lock.disabled = false;
      }
    });

    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "danger";
    forget.textContent = "forget";
    forget.title = "Delete this node, its edges and its vector points";
    forget.addEventListener("click", async () => {
      // One confirmation, because this is the only destructive path in the app.
      if (!forget.dataset.armed) {
        forget.dataset.armed = "1";
        forget.textContent = "sure?";
        setTimeout(() => {
          delete forget.dataset.armed;
          forget.textContent = "forget";
        }, 3000);
        return;
      }
      forget.disabled = true;
      try {
        await call("core_forget", { nodeId: node.id });
        await loadMemories();
      } catch (error) {
        setStatus(String(error), "down");
        forget.disabled = false;
      }
    });

    controls.append(lock, forget);
    item.append(label, meta, controls);
    list.append(item);
  }
}

async function loadHealth() {
  try {
    const health = await call("core_health", {});
    const services = health.services ?? {};
    setStatus(
      `${health.status ?? "ok"} · ${health.backend ?? "?"} · ${health.counts?.nodes ?? 0} memories · extraction ${
        services.extraction ? "llm" : "heuristics"
      } · decay ${health.decay_policy ?? "?"}`,
      health.status === "ok" ? "ok" : "wait"
    );
    return health;
  } catch (error) {
    setStatus(String(error), "down");
    return null;
  }
}

async function loadConfig() {
  try {
    const config = await call("core_config", {});
    el("config").textContent = `${config.core_url} · ${config.owner} · ${config.api_key_set ? "key set" : "no key"}`;
  } catch {
    el("config").textContent = "";
  }
}

async function loadMemories() {
  try {
    const payload = await call("core_list", { limit: 100 });
    renderMemories(payload);
  } catch (error) {
    list.textContent = "";
    const item = document.createElement("li");
    item.className = "empty err";
    item.textContent = String(error);
    list.append(item);
  }
}

async function refresh() {
  await Promise.all([loadHealth(), loadConfig(), loadMemories()]);
}

el("refresh").addEventListener("click", () => void refresh());

el("remember-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const out = el("remember-out");
  const fact = el("fact").value.trim();
  if (!fact) return showError(out, "type something worth remembering first");
  const button = event.target.querySelector("button");
  button.disabled = true;
  button.textContent = "Extracting…";
  try {
    const result = await call("core_remember", { fact });
    const report = result.result ?? result;
    if ((report.triplets_extracted ?? 0) > 0) {
      showResult(
        out,
        `stored ${report.triplets_extracted} relation(s) · ${report.nodes_new ?? 0} new node(s), ${
          report.edges_new ?? 0
        } new edge(s) · extractor ${report.extractor ?? "?"}${
          report.warnings?.length ? ` · warning: ${report.warnings.join(" ")}` : ""
        }`
      );
      el("fact").value = "";
      await refresh();
    } else {
      showError(
        out,
        `nothing durable was found in that text, so nothing was stored (${report.extractor ?? "extractor"}). Try one short imperative statement.`
      );
    }
  } catch (error) {
    showError(out, String(error));
  } finally {
    button.disabled = false;
    button.textContent = "Store it";
  }
});

el("recall-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const out = el("recall-out");
  const prompt = el("prompt").value.trim();
  if (!prompt) return showError(out, "ask the graph something");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const result = await call("core_recall", {
      prompt,
      tokenBudget: Number(el("budget").value) || 600,
    });
    if (!String(result.briefing ?? "").trim()) {
      showError(
        out,
        `no memories matched · scanned ${result.scanned ?? 0} node(s) in ${result.owner_uri ?? "the namespace"} · budget ${
          result.token_budget ?? "?"
        } tokens. That is an honest empty answer, not an error.`
      );
      return;
    }
    showResult(
      out,
      `${result.briefing}\n\n— ${result.memories_found ?? 0} memories · ${result.tokens_used ?? 0}/${
        result.token_budget ?? "?"
      } tokens${result.truncated ? " · truncated to fit" : ""}`
    );
  } catch (error) {
    showError(out, String(error));
  } finally {
    button.disabled = false;
  }
});

// cortex:// links resolved by the Rust deep-link plugin.
await listen("cortex:deep-link", (event) => {
  const payload = event.payload ?? {};
  el("link-panel").hidden = false;
  const out = el("link-out");
  if (payload.error) {
    showError(out, `${payload.uri}\n\n${payload.error}`);
    return;
  }
  const packet = payload.packet ?? {};
  const nodes = packet.nodes ?? [];
  showResult(
    out,
    `${payload.uri}\n\n${packet.briefing ?? "(no briefing)"}\n\n— ${nodes.length} node(s), ${
      (packet.edges ?? []).length
    } edge(s)`
  );
});

// Polling is the honest default: the core broadcasts on /ws, but a desktop
// window that reconnects forever in the background is worse than a 30s refresh.
const timer = setInterval(() => {
  if (document.visibilityState === "visible") void refresh();
}, 30_000);
window.addEventListener("pagehide", () => clearInterval(timer));

await refresh();
