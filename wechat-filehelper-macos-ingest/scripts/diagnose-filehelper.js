#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { navigateToFileHelper, waitForUserReady } from "./lib/chat.js";
import { newRunTimestamp } from "./lib/common.js";
import { probeWeChatStore } from "./lib/store.js";
import { formatUiProbeReport, probeUiEnvironment } from "./lib/ui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    json: false,
    debug: false,
  };

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
  const runTs = newRunTimestamp();
  const runDir = path.join(skillRoot, "local/runs", runTs);
  const artifactDir = path.join(runDir, "artifacts");
  await fs.mkdir(artifactDir, { recursive: true });

  await waitForUserReady();
  await navigateToFileHelper(opts.debug);

  const [uiProbe, storeProbe] = await Promise.all([
    probeUiEnvironment({
      requireChatReady: true,
      debug: opts.debug,
      artifactDir,
      label: "ui-probe",
    }),
    probeWeChatStore({ debug: opts.debug }),
  ]);

  const payload = {
    run_at: new Date().toISOString(),
    ui_probe: uiProbe,
    store_probe: storeProbe,
  };

  await fs.writeFile(path.join(runDir, "ui-probe.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatUiProbeReport(uiProbe));
  console.log("");
  console.log("Store status      :", storeProbe.store_probe_status);
  if (storeProbe.reasons?.length) {
    console.log("Store reasons:");
    for (const reason of storeProbe.reasons) {
      console.log(`- ${reason}`);
    }
  }
  console.log("");
  console.log(`Artifacts saved to: local/runs/${runTs}/ui-probe.json`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
