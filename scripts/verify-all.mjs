#!/usr/bin/env node
/**
 * One command that runs every suite in this repo, and refuses to pretend a suite
 * it could not run passed.
 *
 *   node scripts/verify-all.mjs              # everything
 *   node scripts/verify-all.mjs --quick      # skip the slow build steps
 *   node scripts/verify-all.mjs --only mcp,extension
 *   node scripts/verify-all.mjs --install    # npm install first where node_modules is gone
 *   node scripts/verify-all.mjs --list
 *
 * The important behaviour is the skip path: this project has surfaces that need
 * cargo, Chrome or Windows. A test runner that reports "11/11 passed" while the
 * Rust core was never compiled is how you ship a broken launch, so a skipped
 * suite is printed as a warning in its own line and the exit summary says exactly
 * which claims are unverified.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const values = args.filter((a) => !a.startsWith("--"));

const SUITES = [
  {
    id: "hygiene",
    title: "repo hygiene (versions agree across all manifests)",
    cwd: ".",
    cmd: ["node", "scripts/check-versions.mjs"],
  },
  {
    id: "installer",
    title: "setup-cursor-mcp.sh config-merge safety",
    cwd: ".",
    cmd: ["node", "scripts/test-setup-merge.mjs"],
  },
  {
    id: "core",
    title: "cortex-core: cargo test (unit + HTTP contract)",
    cwd: "cortex-core",
    cmd: ["cargo", "test", "--all-targets"],
    needs: "cargo",
    note: "the only suite that can compile the engine — nothing else here proves the Rust works",
  },
  {
    id: "mcp",
    title: "cortex-mcp: syntax + 28 stdio JSON-RPC assertions",
    cwd: "cortex-mcp",
    cmd: ["npm", "test"],
    deps: true,
  },
  {
    id: "extension",
    title: "cortex-extension: manifest audit + syntax + harvest logic",
    cwd: "cortex-extension",
    cmd: ["npm", "test"],
    deps: false, // no dependencies; npm test is pure node scripts
  },
  {
    id: "js",
    title: "cortex-js: typecheck + contract tests + build + dist audit",
    cwd: "cortex-js",
    cmd: ["npm", "run", "verify"],
    deps: true,
    needsNode: "22.6",
  },
  {
    id: "py",
    title: "cortex-py: unittest (stdlib client)",
    cwd: "cortex-py",
    cmd: ["python3", "-m", "unittest", "discover", "-s", "tests", "-t", "."],
    needs: "python3",
  },
  {
    id: "frontend",
    title: "cortex-frontend: tsc --noEmit + hydrate tests + next build",
    cwd: "cortex-frontend",
    cmd: ["npm", "run", "verify"],
    deps: true,
    slow: true,
    needsNode: "22.6",
  },
  {
    id: "desktop",
    title: "cortex-desktop: cargo check (Tauri Rust side)",
    cwd: "cortex-desktop/src-tauri",
    cmd: ["cargo", "check", "--all-targets"],
    needs: "cargo",
    note: "also needs the webkit2gtk/gtk dev headers on Linux; CI installs them",
  },
];

function has(binary) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, binary + ext))) return true;
  }
  return false;
}

function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

const color = process.stdout.isTTY && !flags.has("--no-color");
const c = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const ok = (t) => c("32", t);
const bad = (t) => c("31", t);
const dim = (t) => c("2", t);
const warn = (t) => c("33", t);

if (flags.has("--list")) {
  for (const s of SUITES) console.log(`${s.id.padEnd(10)} ${s.title}`);
  process.exit(0);
}

const only = values.length ? new Set(values.flatMap((v) => v.split(","))) : null;
if (only) {
  const known = new Set(SUITES.map((s) => s.id));
  for (const id of only) {
    if (!known.has(id)) {
      console.error(`unknown suite: ${id}  (try --list)`);
      process.exit(2);
    }
  }
}

const selected = SUITES.filter((s) => !only || only.has(s.id)).filter(
  (s) => !(flags.has("--quick") && s.slow),
);

console.log(`\nCORTEX verify-all — ${selected.length} suite(s)\n`);

const results = [];
for (const suite of selected) {
  const dir = path.join(ROOT, suite.cwd);
  const record = { suite, status: "ok", duration: 0, output: "" };
  results.push(record);

  if (!fs.existsSync(dir)) {
    Object.assign(record, { status: "skip", reason: `${suite.cwd} not found` });
    console.log(`${dim("– skip")}  ${suite.title}  ${dim(`(${suite.cwd} missing)`)}`);
    continue;
  }
  const missing = suite.needs && !has(suite.needs);
  if (missing) {
    Object.assign(record, { status: "skip", reason: `${suite.needs} not installed` });
    console.log(`${dim("– skip")}  ${suite.title}  ${dim(`(${suite.needs} not available)`)}`);
    if (suite.note) console.log(`         ${dim(suite.note)}`);
    continue;
  }
  if (suite.needsNode) {
    const [M, N] = process.versions.node.split('.').map(Number);
    const [rm, rn] = suite.needsNode.split('.').map(Number);
    if (M < rm || (M === rm && N < rn)) {
      Object.assign(record, { status: 'skip', reason: `needs Node >= ${suite.needsNode} for --experimental-strip-types (this is ${process.version})` });
      console.log(`${dim('- skip')}  ${suite.title}  ${dim(`(Node ${process.version.slice(1)} < ${suite.needsNode})`)}`);
      continue;
    }
  }
  if (suite.deps && !fs.existsSync(path.join(dir, "node_modules"))) {
    if (flags.has("--install")) {
      const installer = fs.existsSync(path.join(dir, "package-lock.json"))
        ? ["npm", "ci", "--no-audit", "--no-fund"]
        : ["npm", "install", "--no-audit", "--no-fund"];
      const install = spawnSync(installer[0], installer.slice(1), { cwd: dir, encoding: "utf8" });
      if (install.status !== 0) {
        Object.assign(record, { status: "fail", reason: "install failed", output: install.stderr || install.stdout });
        console.log(`${bad("✗ fail ")}  ${suite.title}  ${dim("(npm install)")}`);
        continue;
      }
    } else {
      Object.assign(record, { status: "skip", reason: "node_modules missing", hint: "run with --install" });
      console.log(`${dim("– skip")}  ${suite.title}  ${dim("(node_modules missing — re-run with --install)")}`);
      continue;
    }
  }

  process.stdout.write(`${c("36", "… run ")}  ${suite.title}\n`);
  const started = Date.now();
  const run = spawnSync(suite.cmd[0], suite.cmd.slice(1), {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: color ? undefined : "1", FORCE_COLOR: color ? "1" : undefined, npm_config_loglevel: "error" },
  });
  record.duration = Date.now() - started;
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status === 0) {
    record.summary = lastMeaningfulLine(out);
    console.log(`${ok("✓ pass ")}  ${suite.title}  ${dim(fmt(record.duration))}${record.summary ? dim(`  ${record.summary}`) : ""}`);
  } else {
    record.status = "fail";
    record.output = out;
    record.reason = `exit ${run.status ?? "signal"}`;
    console.log(`${bad("✗ fail ")}  ${suite.title}  ${dim(fmt(record.duration))}`);
    const tail = out.trimEnd().split("\n").slice(-25).join("\n");
    if (tail) console.log(dim(tail.split("\n").map((l) => `         ${l}`).join("\n")));
  }
}

function lastMeaningfulLine(out) {
  const lines = out.trim().split("\n").reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/npm (notice|warn)/.test(t)) continue;
    if (/>/.test(t)) continue;
    if (/\d+\/\d+|passed|OK|ok\b|Built|Compiled/i.test(t)) return t.slice(0, 72);
  }
  return "";
}

const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skip");
const passed = results.filter((r) => r.status === "ok");

console.log(`\n${ok(`${passed.length} passed`)} · ${failed.length ? bad(`${failed.length} failed`) : "0 failed"} · ${skipped.length ? warn(`${skipped.length} skipped`) : dim("0 skipped")}`);

if (skipped.length) {
  console.log(`\n${warn("unverified — these claims are NOT proven by this run:")}`);
  for (const r of skipped) console.log(`  • ${r.suite.title}\n    ${dim(`(${r.reason}${r.hint ? ` — ${r.hint}` : ""})`)}`);
}
if (failed.length) {
  console.log(`\n${bad("failing suites:")}`);
  for (const r of failed) console.log(`  • ${r.suite.title} — ${r.reason}`);
  console.log(dim("\n(full output is printed above each failure; re-run one suite with --only <id>)"));
}
process.exit(failed.length ? 1 : 0);
