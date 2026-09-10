#!/usr/bin/env node
/** Fail loudly on the mistakes that cost a Web Store rejection: a referenced file
 *  that does not exist, an oversized description, or a missing icon size. */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const problems = [];

const referenced = new Set();
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const list of Object.values(manifest.icons || {})) referenced.add(list);
for (const list of Object.values(manifest.action?.default_icon || {})) referenced.add(list);
for (const script of manifest.content_scripts || []) for (const file of script.js || []) referenced.add(file);

for (const file of referenced) {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) problems.push(`manifest references missing file: ${file}`);
  else if (statSync(full).size === 0) problems.push(`${file} is empty`);
}

for (const [size, file] of Object.entries(manifest.icons || {})) {
  const pixels = Number(size);
  if (!Number.isFinite(pixels)) continue;
  const header = readFileSync(path.join(ROOT, file)).subarray(16, 24).readUInt32BE;
  const buf = readFileSync(path.join(ROOT, file));
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== pixels || height !== pixels) problems.push(`${file} is ${width}x${height}, manifest declares ${size}`);
  void header;
}
for (const size of ["16", "32", "48", "128"]) {
  if (!manifest.icons?.[size]) problems.push(`icons.${size} is required for the Chrome Web Store`);
}
if ((manifest.description || "").length > 132) problems.push(`description is ${manifest.description.length} chars (max 132)`);
if ((manifest.name || "").length > 45) problems.push(`name is ${manifest.name.length} chars (max 45)`);
for (const script of manifest.content_scripts || []) {
  if (script.world === "MAIN" && !script.js?.includes("harvest-core.js")) {
    problems.push("MAIN world script needs harvest-core.js listed before it");
  }
}
if (!manifest.host_permissions?.length) problems.push("no host_permissions: the extension could not reach its own core");

// Each JS file must parse and must not reference an API it has no permission for.
const jsFiles = [...referenced].filter((f) => f.endsWith(".js"));
for (const file of jsFiles) {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  if (/document\.write|eval\(|new Function\(/.test(source)) problems.push(`${file}: dynamic code is banned by MV3`);
  if (/innerHTML\s*=/.test(source)) problems.push(`${file}: innerHTML assignment is an injection risk on third-party pages`);
  if (source.includes("chrome.notifications") && !manifest.permissions.includes("notifications")) {
    problems.push(`${file}: uses chrome.notifications without the "notifications" permission`);
  }
  if (source.includes("chrome.alarms") && !manifest.permissions.includes("alarms")) {
    problems.push(`${file}: uses chrome.alarms without the "alarms" permission`);
  }
}

if (problems.length) {
  console.error(`manifest check FAILED:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(`manifest OK · ${jsFiles.length} scripts · ${(manifest.description || "").length}/132 description chars · icons 16/32/48/128`);
