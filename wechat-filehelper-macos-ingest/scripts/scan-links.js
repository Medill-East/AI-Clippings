#!/usr/bin/env node
/**
 * scan-links.js — Extract WeChat article links from File Transfer Assistant
 * via macOS desktop app Accessibility API and merge into the local JSONL index.
 *
 * Usage:
 *   node scripts/scan-links.js --since <ISO8601> --until <ISO8601> [--max-scrolls N] [--reindex] [--debug]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { navigateToFileHelper, scrollAndCollect } from "./lib/chat.js";
import {
  readJsonlines,
  writeJsonlines,
  mergeRecords,
  newRunTimestamp,
} from "./lib/common.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    since: null,
    until: null,
    maxScrolls: 50,
    reindex: false,
    debug: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--since":
        opts.since = args[++i];
        break;
      case "--until":
        opts.until = args[++i];
        break;
      case "--max-scrolls":
        opts.maxScrolls = Math.min(200, Math.max(1, parseInt(args[++i], 10)));
        break;
      case "--reindex":
        opts.reindex = true;
        break;
      case "--debug":
        opts.debug = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!opts.since || !opts.until) {
    console.error("Error: --since and --until are required.");
    printUsage();
    process.exit(1);
  }

  const since = new Date(opts.since);
  const until = new Date(opts.until);
  if (isNaN(since.getTime()) || isNaN(until.getTime())) {
    console.error("Error: --since and --until must be valid ISO 8601 date-time strings.");
    process.exit(1);
  }
  if (since > until) {
    console.error("Error: --since must be before --until.");
    process.exit(1);
  }

  return { ...opts, since, until };
}

function printUsage() {
  console.error(`
Usage:
  node scripts/scan-links.js --since <ISO8601> --until <ISO8601> [options]

Options:
  --since <ISO8601>     Start time (inclusive), e.g. 2026-03-28T15:00:00+08:00
  --until <ISO8601>     End time (inclusive), e.g. 2026-03-28T23:59:59+08:00
  --max-scrolls N       Maximum upward scrolls (default 50, max 200)
  --reindex             Clear existing index before scan
  --debug               Print verbose debug output
`);
}

function waitForUserReady() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\n请在微信中打开「文件传输助手」聊天，然后按 Enter 继续...");
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("Error: 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }

  const opts = parseArgs(process.argv);

  const indexPath = path.join(skillRoot, "local/index/links.jsonl");
  const runTs = newRunTimestamp();
  const runDir = path.join(skillRoot, "local/runs", runTs);
  await fs.mkdir(runDir, { recursive: true });

  console.log("WeChat FileHelper macOS Ingest — Scan (clipboard mode)");
  console.log(`Since : ${opts.since.toISOString()}`);
  console.log(`Until : ${opts.until.toISOString()}`);
  console.log(`Max scrolls: ${opts.maxScrolls}`);
  if (opts.reindex) console.log("Mode  : REINDEX (clearing existing index)");
  console.log("-".repeat(50));

  if (opts.reindex) {
    await fs.rm(indexPath, { force: true });
    console.log("Existing index cleared.");
  }

  let newRecords = [];

  // Prompt user to manually open File Helper before proceeding
  await waitForUserReady();

  console.log("Activating WeChat window...");
  try {
    await navigateToFileHelper(opts.debug);
  } catch (err) {
    console.error("\nFatal error:", err.message);
    console.error("Tip: Run `node scripts/setup.js` to verify prerequisites.");
    process.exit(1);
  }

  console.log("Scanning messages (using clipboard extraction)...");
  newRecords = await scrollAndCollect(
    opts.since,
    opts.until,
    opts.maxScrolls,
    opts.debug
  );

  console.log(`Collected ${newRecords.length} link(s) from this scan.`);

  // Merge into index
  const existing = await readJsonlines(indexPath);
  const merged = mergeRecords(existing, newRecords);
  const addedCount = merged.length - existing.length;
  await writeJsonlines(indexPath, merged);

  console.log(`Added ${addedCount} new link(s) to index (${merged.length} total).`);

  // Write run manifest
  const manifest = {
    run_at: new Date().toISOString(),
    since: opts.since.toISOString(),
    until: opts.until.toISOString(),
    max_scrolls: opts.maxScrolls,
    reindex: opts.reindex,
    collected: newRecords.length,
    added_to_index: addedCount,
    index_total: merged.length,
  };
  await fs.writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  console.log(`\nRun manifest saved to: local/runs/${runTs}/manifest.json`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
