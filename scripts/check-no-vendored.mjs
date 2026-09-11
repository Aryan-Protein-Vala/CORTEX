#!/usr/bin/env node
// Fail if build output or installed dependencies are tracked in git.
//
// Why this exists: `cortex-mcp/node_modules` was committed on an older branch, and a later sandbox
// restore moved the branch pointer back to that base while the files were still on disk. A plain
// `git add -A` re-staged 3,619 vendored files and the push went out before the diffstat was read.
// `.gitignore` cannot save you there — it never applies to paths git already tracks — which is the
// whole reason this is a check on `git ls-files` rather than a rule in the ignore file.
//
// What "vendored" means here, and the exceptions, are stated as data below so a reviewer can argue
// with the list instead of with a comment.
import { spawnSync } from "node:child_process";

const FORBIDDEN = [
  { re: /(^|\/)node_modules\//, why: "installed dependencies; `npm ci` from the lockfile is the source of truth" },
  { re: /(^|\/)\.next\//, why: "Next.js build output" },
  { re: /(^|\/)dist\/.+\.js$/, why: "build output (publish-time artifacts are produced by `npm run build`)" },
  { re: /(^|\/)target\/debug\//, why: "debug build artifacts" },
];

// Lockfiles and generated-but-shipped assets stay: a committed Cargo.lock for a binary app is the
// convention, and the extension's icons are hand-authored assets, not build output.
const ALLOW = [/(^|\/)node_modules\/\.package-lock\.json$/];

const git = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (git.status !== 0) {
  console.error("git ls-files failed:", git.stderr || "is this a git checkout?");
  process.exit(2);
}
const tracked = git.stdout.split("\0").filter(Boolean);

const offenders = [];
for (const file of tracked) {
  if (ALLOW.some((re) => re.test(file))) continue;
  const hit = FORBIDDEN.find(({ re }) => re.test(file));
  if (hit) offenders.push({ file, why: hit.why });
}

if (offenders.length === 0) {
  console.log(`no vendored build output tracked (${tracked.length} files in git) ✓`);
  process.exit(0);
}

const byDir = new Map();
for (const { file } of offenders) {
  const dir = file.split("/").slice(0, 2).join("/");
  byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
}
console.error(`${offenders.length} tracked file(s) should not be in git:`);
for (const [dir, n] of [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const why = FORBIDDEN.find(({ re }) => offenders.some((o) => o.file.startsWith(dir) && re.test(o.file)))?.why ?? "";
  console.error(`  ${dir}/ — ${n} file(s) — ${why}`);
}
console.error("\nUntrack without deleting them from disk:");
for (const dir of byDir.keys()) console.error(`  git rm -r --cached ${JSON.stringify(dir)}`);
console.error("\n(then commit; .gitignore already covers new ones — it only fails to apply to paths git tracks)");
process.exit(1);
