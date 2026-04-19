#!/usr/bin/env node
/**
 * collect-links.js — One-command entrypoint that scans and immediately prints
 * query results for the same time range.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatQueryUsage, runQuery } from "./lib/query.js";
import { formatScanUsage, parseScanArgs, runScan } from "./lib/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseCollectArgs(argv) {
  const args = argv.slice(2);
  const scanArgs = [argv[0], argv[1]];
  let format = "md";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format") {
      format = args[i + 1];
      if (!["text", "json", "md"].includes(format)) {
        throw new Error(`Unknown format: ${format}. Use text, json, or md.`);
      }
      i += 1;
      continue;
    }

    scanArgs.push(args[i]);
  }

  const scanOpts = parseScanArgs(scanArgs);
  return { ...scanOpts, format };
}

function formatCollectUsage() {
  return [
    "Usage:",
    "  node scripts/collect-links.js --since <ISO8601> --until <ISO8601> [options]",
    "",
    "Options:",
    "  --source <mode>       auto | ui | store | clipboard (default auto)",
    "  --format <mode>       text | json | md (default md)",
    "  --max-scrolls N       Maximum upward scrolls for UI/clipboard scanning (default 50, max 200)",
    "  --reindex             Clear existing index before scan",
    "  --debug               Print verbose debug output",
  ].join("\n");
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("Error: 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }

  let opts;
  try {
    opts = parseCollectArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error("");
    console.error(formatCollectUsage());
    console.error("");
    console.error(formatScanUsage());
    console.error(formatQueryUsage());
    process.exit(1);
  }

  const scanResult = await runScan(opts, { skillRoot });

  const queryResult = await runQuery({
    skillRoot,
    since: opts.since,
    until: opts.until,
    format: opts.format,
  });

  console.log("");
  if (
    scanResult.newRecords.length === 0 &&
    (scanResult.uncertainRecords?.length ?? 0) === 0 &&
    (scanResult.pendingRecords?.length ?? 0) === 0 &&
    (scanResult.skippedRecords?.length ?? 0) === 0 &&
    (
      queryResult.records.length > 0 ||
      (queryResult.uncertainLinks?.length ?? 0) > 0 ||
      (queryResult.pendingItems?.length ?? 0) > 0 ||
      (queryResult.skippedCards?.length ?? 0) > 0
    )
  ) {
    console.log("本次扫描没有新增链接；下面展示的是该时间范围内已有索引中的结果。");
    console.log("");
  }
  console.log(queryResult.rendered);
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
