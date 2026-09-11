import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Declarations come from `tsc` (see tsconfig.build.json): tsup's dts pipeline
  // cannot load this repo's TypeScript version, and a broken dts step silently
  // ships an untyped package.
  sourcemap: true,
  clean: true,
  target: "es2022",
});
