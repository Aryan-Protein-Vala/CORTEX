#!/usr/bin/env node
/**
 * The published artifact is a different thing from the source it was built from,
 * so it gets its own check: both module systems must actually expose the names the
 * README tells people to import, and the type declarations must exist.
 *
 * This exists because a CI step once asserted `CortexClient` — a class nobody ever
 * wrote — and passed in my head until someone ran the build. Two named exports and
 * a `.d.ts` file cost 30 lines to verify and save that whole failure mode.
 *
 *   npm run build && node scripts/check-dist.mjs      (or: npm run verify)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const require = createRequire(import.meta.url);

const EXPECTED = ["Cortex", "Client", "CortexError", "default"];
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    console.error(`  \u2717 ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

check("the build ran (dist/ exists)", () => {
  assert.ok(fs.existsSync(DIST), "dist/ missing — run `npm run build` first");
});

check("CJS exports the documented names", () => {
  const mod = require(path.join(DIST, "index.cjs"));
  for (const name of EXPECTED) assert.ok(name in mod, `require('cortex-js').${name} is missing`);
  assert.equal(typeof mod.Cortex, "function");
  assert.equal(mod.Client, mod.Cortex, "the Client alias must be the same class, not a copy");
  assert.equal(mod.default, mod.Cortex, "default export must be Cortex");
});

const esm = await import(path.join(DIST, "index.js"));
check("ESM exports the documented names", () => {
  for (const name of EXPECTED) assert.ok(name in esm, `import { ${name} } fails against dist/index.js`);
  assert.equal(esm.default, esm.Cortex);
});

check("type declarations ship and describe the real class", () => {
  const dts = path.join(DIST, "index.d.ts");
  assert.ok(fs.existsSync(dts), "dist/index.d.ts missing (tsc -p tsconfig.build.json must run after tsup)");
  const text = fs.readFileSync(dts, "utf8");
  assert.match(text, /Cortex/, "index.d.ts does not mention Cortex");
  assert.ok(
    fs.existsSync(path.join(DIST, "client.d.ts")),
    "client.d.ts missing — the public types live there and consumers need it",
  );
});

check("package.json exports map points at files that exist", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const target of [pkg.main, pkg.module, pkg.types, ...Object.values(pkg.exports["."]).filter((v) => typeof v === "string")]) {
    assert.ok(fs.existsSync(path.join(ROOT, target.replace(/^\.\//, ""))), `${target} is declared but absent`);
  }
});

check("the CJS bundle has no stray ESM syntax", () => {
  const text = fs.readFileSync(path.join(DIST, "index.cjs"), "utf8");
  assert.doesNotMatch(text, /^export\s/m, "dist/index.cjs contains ESM `export` — consumers on require() will crash");
  assert.match(text, /module\.exports|__export/, "dist/index.cjs does not look like a CommonJS module");
});

if (!process.exitCode) console.log(`\n${passed}/${passed} dist checks passed`);
else console.error("\ndist checks FAILED");
