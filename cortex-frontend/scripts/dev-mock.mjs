/**
 * `npm run dev:mock` — the dashboard against a stub core, no cargo required.
 * Starts the mock core on 3941, exports it as the proxy target, then runs `next dev`.
 */
import { spawn } from "node:child_process";

const core = spawn(process.execPath, ["scripts/mock-core.mjs"], { stdio: "inherit", env: { ...process.env, CORTEX_MOCK_LOG: "/tmp/mockcore.log" } });
const next = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  env: { ...process.env, CORTEX_API_URL: "http://127.0.0.1:3941", CORTEX_API_KEY: "testkey" },
});

const stop = () => {
  core.kill("SIGTERM");
  next.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
