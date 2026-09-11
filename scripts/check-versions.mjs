#!/usr/bin/env node
/**
 * One version for the whole repo, or the release notes lie.
 *
 * This repo has fourteen version-carrying files: two Cargo.tomls, five package.json
 * files, four package-locks, the extension's manifest.json, tauri.conf.json and
 * setup.py. There is no release automation to keep them honest. The failure
 * mode is boring and permanent: README says v1.1, the extension says 1.0, and
 * the bug report nobody can triage. So the check is dumb and strict: every
 * manifest must carry the same version, and CHANGELOG.md must have an
 * `## [Unreleased]` section or the exact release heading for that version.
 *
 *   node scripts/check-versions.mjs            # verify
 *   node scripts/check-versions.mjs 0.2.0      # rewrite every manifest to 0.2.0
 *                                      # (the CHANGELOG entry stays a human job)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MANIFESTS = [
  { file: "cortex-core/Cargo.toml", kind: "cargo", label: "cortex-core" },
  { file: "cortex-mcp/package.json", kind: "npm", label: "cortex-mcp" },
  { file: "cortex-extension/package.json", kind: "npm", label: "cortex-extension (dev tooling)" },
  { file: "cortex-extension/manifest.json", kind: "npm", label: "cortex-extension (manifest_version)" },
  { file: "cortex-frontend/package.json", kind: "npm", label: "cortex-frontend" },
  { file: "cortex-js/package.json", kind: "npm", label: "cortex-js" },
  { file: "cortex-desktop/package.json", kind: "npm", label: "cortex-desktop (npm)" },
  { file: "cortex-desktop/src-tauri/Cargo.toml", kind: "cargo", label: "cortex-desktop (tauri crate)" },
  { file: "cortex-desktop/src-tauri/tauri.conf.json", kind: "npm", label: "cortex-desktop (bundle config)" },
  { file: "cortex-py/setup.py", kind: "python", label: "cortex-py" },
  // Lockfiles carry the root package's version too; a stale one is how "the lock
  // says 1.0.0 but the package says 0.1.0" bug reports start.
  { file: "cortex-mcp/package-lock.json", kind: "lock", label: "cortex-mcp (lockfile)" },
  { file: "cortex-js/package-lock.json", kind: "lock", label: "cortex-js (lockfile)" },
  { file: "cortex-frontend/package-lock.json", kind: "lock", label: "cortex-frontend (lockfile)" },
  { file: "cortex-desktop/package-lock.json", kind: "lock", label: "cortex-desktop (lockfile)" },
];

const readVersion = (file, kind) => {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (kind === "lock") {
    const data = JSON.parse(text);
    return data?.packages?.[""]?.version ?? data?.version ?? null;
  }
  if (kind === "cargo") return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  if (kind === "python") return text.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? null;
  return text.match(/"version"\s*:\s*"([^"]+)"/)?.[1] ?? null;
};

const writeVersion = (file, kind, next) => {
  const full = path.join(ROOT, file);
  const text = fs.readFileSync(full, "utf8");
  if (kind === "lock") {
    // Parse/stringify rather than regex: a lockfile has one version per package
    // entry and a careless replace would rewrite thousands of them.
    const data = JSON.parse(text);
    if (data?.packages?.[""]) data.packages[""].version = next;
    if (typeof data?.version === "string") data.version = next;
    const out = JSON.stringify(data, null, 2) + "\n";
    if (out !== text) fs.writeFileSync(full, out);
    return out !== text;
  }
  let out;
  if (kind === "cargo") out = text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`);
  else if (kind === "python") out = text.replace(/version\s*=\s*"[^"]+"/, `version="${next}"`);
  else out = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  if (out !== text) fs.writeFileSync(full, out);
  return out !== text;
};

const requested = process.argv[2];
if (requested && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(requested)) {
  console.error(`not a semver version: ${requested}`);
  process.exit(2);
}

if (requested) {
  let changed = 0;
  for (const m of MANIFESTS) {
    if (!fs.existsSync(path.join(ROOT, m.file))) {
      console.error(`missing ${m.file}`);
      process.exit(1);
    }
    if (writeVersion(m.file, m.kind, requested)) {
      changed++;
      console.log(`  → ${m.label}: ${requested}`);
    }
  }
  // The changelog is the release note. Rewriting it automatically would invent an
  // empty section for a version that has not been released, so the script only
  // says whether the heading exists and leaves the writing to a human.
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${requested}]`)) {
    console.log(`  ! CHANGELOG.md has no [${requested}] section yet — write it before tagging.`);
  }

console.log(changed ? `${changed} manifest(s) updated to ${requested}` : `already at ${requested}`);
  process.exit(0);
}

const found = [];
const errors = [];
for (const m of MANIFESTS) {
  const full = path.join(ROOT, m.file);
  if (!fs.existsSync(full)) {
    errors.push(`${m.file} is missing (listed as a version-carrying manifest)`);
    continue;
  }
  const version = readVersion(m.file, m.kind);
  if (!version) {
    errors.push(`${m.file}: no version field found — the checker's regex and the file disagree`);
    continue;
  }
  found.push({ ...m, version });
}

const distinct = [...new Set(found.map((f) => f.version))];
if (distinct.length > 1) {
  errors.push(`versions disagree: ${distinct.join(" vs ")}`);
  for (const f of found) console.log(`  ${f.version.padEnd(9)} ${f.file}`);
}

const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
if (!/^## \[Unreleased\]/m.test(changelog)) errors.push("CHANGELOG.md has no `## [Unreleased]` heading");
if (distinct.length === 1 && distinct[0] !== "0.0.0" && !changelog.includes(`## [${distinct[0]}]`) && /^## \[Unreleased\]/m.test(changelog)) {
  // Allowed while unreleased, but say so rather than letting it drift silently.
  console.log(`note: ${distinct[0]} has no CHANGELOG release section yet (fine while everything is Unreleased)`);
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  console.error("\nfix: node scripts/check-versions.mjs <version>   # rewrites every manifest");
  process.exit(1);
}

console.log(`all ${found.length} manifests agree on ${distinct[0]}`);
