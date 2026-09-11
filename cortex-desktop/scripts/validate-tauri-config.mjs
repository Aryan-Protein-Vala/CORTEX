#!/usr/bin/env node
// Gate for src-tauri/tauri.conf.json, run by CI and by `node scripts/verify-all.mjs`.
//
// Why a file instead of an inline `node -e` in the workflow: an inline blob cannot be executed
// locally, cannot be tested against a bad config, and its failure mode is a stack trace. Two real
// bugs reached `cargo check` this way — `security` at the config root (Tauri wants
// `app.security`) and `nsis.installModes` (newer schema than the pinned tauri-build) — while the
// inline validator reported "all good", because it only looked at the keys it remembered.
//
// Scope, stated honestly: this checks the handful of fields that break the build or the security
// posture. It is NOT the Tauri JSON schema — the schema host is unreachable from where this repo is
// developed, so the root key list below was copied from tauri-build's own deny_unknown_fields
// message. Anything outside it is validated by the compiler, not here.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src-tauri");
const configPath = resolve(root, "tauri.conf.json");

const errors = [];
const fail = (msg) => errors.push(msg);

const ROOT_KEYS = [
  "$schema", "productName", "version", "identifier", "app", "build", "bundle", "plugins",
];

let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(`tauri.conf.json: cannot read/parse (${err.message})`);
  process.exit(1);
}

for (const key of Object.keys(cfg)) {
  if (!ROOT_KEYS.includes(key)) {
    fail(`unknown root field "${key}"; this pinned tauri-build only accepts: ${ROOT_KEYS.join(", ")}`);
  }
}

const app = cfg.app ?? {};
if (!Array.isArray(app.windows) || app.windows.length === 0) {
  fail("app.windows is empty; the app would launch with no window");
} else {
  // A window with no `url` is fine: it loads frontendDist's index.html. What must not happen is a
  // page that reaches Rust through a global, which is exactly what withGlobalTauri turns on.
  // withGlobalTauri is deliberate here, not sloppiness: src/ is served straight from disk with no
  // bundler, so `import { invoke } from "@tauri-apps/api/core"` would need a build step this app
  // does not have. The global is acceptable only while script-src is strict, because an injected
  // script holding window.__TAURI__ can call any command - which is why that pairing is enforced.
  if (app.withGlobalTauri === true) {
    const csp = app.security?.csp ?? "";
    const scriptSrc = /(^|;)\s*script-src\s+([^;]+)/.exec(csp)?.[2] ?? "";
    if (!scriptSrc.includes("'self'") || /unsafe-inline|unsafe-eval|\*/.test(scriptSrc)) {
      fail("app.withGlobalTauri is on, so script-src must be exactly 'self' - the global is only safe while injection is impossible");
    }
  }
  for (const [i, win] of app.windows.entries()) {
    if (win.url && /^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(win.url)) {
      fail(`app.windows[${i}].url points at a remote origin (${win.url}); a memory shell must load local files`);
    }
    if (win.initializationScript && /fetch\(|XMLHttpRequest/.test(win.initializationScript)) {
      fail(`app.windows[${i}].initializationScript runs before the page loads and is doing network I/O`);
    }
  }
}

const sec = app.security ?? {};
if (!("security" in app)) fail("app.security is missing entirely");
if (!sec.csp) {
  fail("app.security.csp is missing; this webview can reach the core over 127.0.0.1, so it needs a policy");
} else {
  const csp = sec.csp;
  // Group 2, not 1: group 1 is the `^|;` separator. Getting this wrong made every rule fire on a
  // perfectly good policy, which is the kind of gate that teaches people to delete gates.
  const directive = (name) => new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp)?.[1]?.trim();
  if (!directive("default-src")?.includes("'self'")) fail("csp: default-src must be 'self'");
  if (!directive("script-src")?.includes("'self'")) fail("csp: script-src must pin 'self', or an injected script owns the API key");
  if (/'unsafe-inline'|'unsafe-eval'/.test(directive("script-src") ?? "")) fail("csp: script-src must not allow unsafe-inline/unsafe-eval");
  if ((directive("object-src") ?? "'none'") !== "'none'") fail("csp: object-src must be 'none'");
  if ((directive("base-uri") ?? "'self'") !== "'self'") fail("csp: base-uri must be 'self'");
  const connect = directive("connect-src") ?? "";
  if (!/\bipc:|ipc\.localhost/.test(connect)) fail("csp: connect-src must allow ipc: / http://ipc.localhost or invoke() cannot reach Rust");
  if (!/127\.0\.0\.1:3030/.test(connect)) fail("csp: connect-src must include http://127.0.0.1:3030 (and ws: same origin) for the core");
  // Allowlist, not a clever regex: the first attempt used a negative lookahead and flagged
  // `http://ipc.localhost` (Tauri's own IPC origin) as remote, which would have pushed someone to
  // loosen the CSP to silence a gate they could not read.
  const LOCAL_SOURCE = /^('self'|ipc:|http:\/\/ipc\.localhost|https?:\/\/localhost(?::\d+)?|https?:\/\/127\.0\.0\.1(?::\d+)?|ws:\/\/127\.0\.0\.1(?::\d+)?|wss?:\/\/localhost(?::\d+)?)$/;
  for (const source of connect.split(/\s+/).filter(Boolean)) {
    if (!LOCAL_SOURCE.test(source)) {
      fail(`csp: connect-src allows "${source}", which is not the loopback core or Tauri IPC; a memory app must not be able to phone a remote origin from the webview`);
    }
  }
}

const build = cfg.build ?? {};
if (build.devUrl) fail("build.devUrl is committed; a release build would load a dev server");
const dist = build.frontendDist;
if (!dist) {
  fail("build.frontendDist is missing");
} else if (!existsSync(resolve(root, dist))) {
  fail(`build.frontendDist "${dist}" does not exist relative to src-tauri`);
} else if (!existsSync(resolve(root, dist, "index.html"))) {
  fail(`build.frontendDist "${dist}" has no index.html; tauri build will fail with a confusing error`);
}
if (build.removeUnusedCommands === true && !app.windows?.some((w) => w)) {
  fail("build.removeUnusedCommands is set with no windows configured");
}

if (!/^[a-zA-Z0-9_.-]+$/.test(cfg.identifier ?? "")) fail("identifier must be a reverse-domain id like com.example.app");
else if ((cfg.identifier ?? "").endsWith(".app")) fail("identifier ending in .app is rejected on macOS packaging");
if (!cfg.productName) fail("productName is empty; installers and the window title both read it");

const bundle = cfg.bundle ?? {};
if (bundle.active === true) {
  for (const icon of bundle.icon ?? []) {
    if (!existsSync(resolve(root, icon))) fail(`bundle.icon references "${icon}" which is not in the repo (run: npx @tauri-apps/cli icon)`);
  }
  if (!bundle.publisher) fail("bundle.publisher is empty; the Windows installer shows it in Add/Remove Programs");
  const nsis = bundle.windows?.nsis;
  for (const key of Object.keys(nsis ?? {})) {
    if (key === "installModes") {
      fail('bundle.windows.nsis.installModes is newer than the pinned tauri-build (deny_unknown_fields); drop it or run `cargo update` in src-tauri');
    }
  }
}

if (errors.length) {
  console.error(`tauri.conf.json failed ${errors.length} check(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`tauri.conf.json OK — ${app.windows.length} window(s), CSP enforced, frontendDist "${dist}", ${Object.keys(cfg).length} root keys all in the pinned schema`);
