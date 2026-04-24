#!/usr/bin/env node
import { config } from "./config.js";
import { createApp, insecureStartupProblem } from "./app.js";

// Refuse to start insecure-by-default on a non-loopback bind.
const problem = insecureStartupProblem();
if (problem) {
  console.error(`\n[browser-mcp] REFUSING TO START\n  ${problem}\n`);
  process.exit(2);
}

const { httpServer, shutdownApp } = createApp();

async function shutdown() {
  await shutdownApp();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(config.port, config.host, () => {
  console.error(`browser-mcp listening on http://${config.host}:${config.port}/mcp`);
  console.error(`  health       → http://${config.host}:${config.port}/health`);
  console.error(`  /mcp         → default profile`);
  console.error(`  /mcp/<name>  → named profile (e.g. /mcp/test1)`);
  console.error(`  auth         → ${config.apiKey ? "Bearer token required" : "DISABLED (loopback only)"}`);
  console.error(`  cors_origin  → ${config.corsOrigin}`);
  console.error(`  max_sessions → ${config.maxSessions}`);
});
