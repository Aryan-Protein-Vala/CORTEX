#!/usr/bin/env node
/**
 * Tests for ./setup-cursor-mcp.sh — the one script in this repo that can
 * *destroy* something a user cares about, so it gets a test suite.
 *
 * It runs the real bash script against a throwaway tree and asserts:
 *   1. it merges instead of overwriting other MCP servers
 *   2. re-running it changes nothing (idempotent)
 *   3. unparseable config → refusal, file left byte-identical
 *   4. empty config file → written, not an error
 *   5. --remove takes only our entry out
 *
 *   node scripts/test-setup-merge.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "setup-cursor-mcp.sh");

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  \u2717 ${name}\n      ${error.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${what}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-setup-"));
  fs.mkdirSync(path.join(dir, "cortex-mcp", "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cortex-mcp", "index.js"), "console.log('stub')\n");
  fs.copyFileSync(SCRIPT, path.join(dir, "setup-cursor-mcp.sh"));
  fs.chmodSync(path.join(dir, "setup-cursor-mcp.sh"), 0o755);
  return dir;
}

function run(dir, args = []) {
  try {
    const stdout = execFileSync(path.join(dir, "setup-cursor-mcp.sh"), ["--cursor", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status === undefined ? -1 : error.status,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

const configPath = (dir) => path.join(dir, ".cursor", "mcp.json");
const readConfig = (dir) => {
  const file = configPath(dir);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
};

console.log("\nsetup-cursor-mcp.sh");

check("merges beside an existing server and keeps a backup", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify({ mcpServers: { notion: { command: "notion-mcp" } }, keepMe: 1 }, null, 2));

  const out = run(dir);
  assert(out.code === 0, `script exited ${out.code}: ${out.stderr}`);
  const cfg = readConfig(dir).json;
  assert(cfg.mcpServers.notion, "the user's other server was deleted");
  assert(cfg.mcpServers.cortex, "cortex was not added");
  eq(cfg.mcpServers.cortex.args, [path.join(dir, "cortex-mcp", "index.js")], "entry path");
  assert(cfg.mcpServers.cortex.env.CORTEX_API_URL, "env.CORTEX_API_URL missing");
  assert(cfg.keepMe === 1, "unrelated top-level keys were dropped");
  assert(!cfg.mcpServers.cortex.env.CORTEX_API_KEY, "an empty CORTEX_API_KEY should be omitted, not sent as blank");
  const backups = fs.readdirSync(path.join(dir, ".cursor")).filter((f) => f.includes("cortex-backup"));
  assert(backups.length === 1, `expected exactly one backup, got ${backups.length}`);
  const backed = JSON.parse(fs.readFileSync(path.join(dir, ".cursor", backups[0]), "utf8"));
  assert(backed.mcpServers.notion, "the backup did not capture the pre-change state");
});

check("omits CORTEX_API_KEY entirely when unset, includes it when set", () => {
  const dir = sandbox();
  execFileSync(path.join(dir, "setup-cursor-mcp.sh"), ["--cursor"], {
    env: { ...process.env, CORTEX_API_KEY: "cx_test_1234" },
    stdio: "ignore",
  });
  eq(readConfig(dir).json.mcpServers.cortex.env.CORTEX_API_KEY, "cx_test_1234", "key passed through");
});

check("re-running is a no-op (no rewrite, no new backup)", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify({ mcpServers: {} }));
  run(dir);
  const first = readConfig(dir).raw;
  const backupsAfterFirst = fs.readdirSync(path.join(dir, ".cursor")).filter((f) => f.includes("cortex-backup")).length;
  const out = run(dir);
  assert(/already configured/.test(out.stdout), `expected a no-op message, got:\n${out.stdout}`);
  assert(readConfig(dir).raw === first, "the file changed on the second run");
  const backups = fs.readdirSync(path.join(dir, ".cursor")).filter((f) => f.includes("cortex-backup"));
  assert(backups.length === backupsAfterFirst, `second run added backups (${backupsAfterFirst} -> ${backups.length})`);
});

check("refuses an unparseable config and leaves it byte-identical", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  const broken = '{ "mcpServers": { oops\n';
  fs.writeFileSync(configPath(dir), broken);
  const out = run(dir);
  assert(out.code === 3, `expected exit 3, got ${out.code}`);
  assert(/REFUSING/.test(out.stderr), "expected an explicit refusal on stderr");
  assert(readConfig(dir).raw === broken, "the broken file was modified");
});

check("creates an empty config instead of failing on it", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  fs.writeFileSync(configPath(dir), "   \n");
  const out = run(dir);
  assert(out.code === 0, `expected success on an empty file, exit ${out.code}`);
  assert(readConfig(dir).json.mcpServers.cortex, "cortex not written");
});

check("--remove drops only the cortex entry", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify({ mcpServers: { notion: { command: "x" } } }));
  run(dir);
  const out = run(dir, ["--remove"]);
  assert(out.code === 0, `remove exited ${out.code}`);
  const cfg = readConfig(dir).json;
  assert(!cfg.mcpServers.cortex, "cortex survived removal");
  assert(cfg.mcpServers.notion, "the other server was removed as collateral damage");
  const again = run(dir, ["--remove"]);
  assert(/nothing to remove/.test(again.stdout), `second remove should be quiet: ${again.stdout}`);
});

check("--dry-run writes nothing", () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify({ mcpServers: { notion: { command: "x" } } }));
  const before = readConfig(dir).raw;
  const out = run(dir, ["--dry-run"]);
  assert(out.code === 0, `dry run exited ${out.code}`);
  assert(readConfig(dir).raw === before, "dry run modified the config");
  assert(fs.readdirSync(path.join(dir, ".cursor")).length === 1, "dry run left extra files behind");
});

check("missing cortex-mcp entry point fails loudly", () => {
  const dir = sandbox();
  fs.rmSync(path.join(dir, "cortex-mcp", "index.js"));
  const out = run(dir);
  assert(out.code !== 0, "expected a non-zero exit when index.js is missing");
  assert(/missing/.test(out.stderr) || /missing/.test(out.stdout), "expected a clear 'missing' message");
});

const total = passed + failures.length;
console.log(`\n${passed}/${total} checks passed`);
if (failures.length) {
  for (const f of failures) console.error(`  FAILED ${f}`);
  process.exit(1);
}
