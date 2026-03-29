#!/usr/bin/env node
/**
 * probe-store.js — Diagnose whether the local macOS WeChat store is usable.
 */

import { probeWeChatStore, formatProbeReport } from "./lib/store.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { json: false, debug: false };

  for (const arg of args) {
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    if (arg === "--debug") {
      opts.debug = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("Error: 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }

  const opts = parseArgs(process.argv);
  const probe = await probeWeChatStore({ debug: opts.debug });

  if (opts.json) {
    console.log(JSON.stringify(probe, null, 2));
    return;
  }

  console.log(formatProbeReport(probe));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
