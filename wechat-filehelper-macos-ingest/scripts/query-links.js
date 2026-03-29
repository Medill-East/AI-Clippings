#!/usr/bin/env node
/**
 * query-links.js — Query the local JSONL index by time range.
 *
 * Usage:
 *   node scripts/query-links.js --since <ISO8601> --until <ISO8601> [--format text|json|md]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonlines, filterByTimeRange } from "./lib/common.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { since: null, until: null, format: "text" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--since":
        opts.since = args[++i];
        break;
      case "--until":
        opts.until = args[++i];
        break;
      case "--format":
        opts.format = args[++i];
        if (!["text", "json", "md"].includes(opts.format)) {
          console.error(`Unknown format: ${opts.format}. Use text, json, or md.`);
          process.exit(1);
        }
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!opts.since || !opts.until) {
    console.error("Error: --since and --until are required.");
    console.error("Usage: node scripts/query-links.js --since <ISO8601> --until <ISO8601> [--format text|json|md]");
    process.exit(1);
  }

  const since = new Date(opts.since);
  const until = new Date(opts.until);
  if (isNaN(since.getTime()) || isNaN(until.getTime())) {
    console.error("Error: Invalid date format.");
    process.exit(1);
  }

  return { ...opts, since, until };
}

async function main() {
  const opts = parseArgs(process.argv);
  const indexPath = path.join(skillRoot, "local/index/links.jsonl");

  const all = await readJsonlines(indexPath);
  if (all.length === 0) {
    console.error("Index is empty. Run scan-links.js first.");
    process.exit(0);
  }

  const results = filterByTimeRange(all, opts.since, opts.until);

  // Deduplicate by URL (keep first occurrence per URL)
  const seen = new Set();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (deduped.length === 0) {
    console.log("No links found in the specified time range.");
    return;
  }

  switch (opts.format) {
    case "json":
      console.log(JSON.stringify(deduped, null, 2));
      break;
    case "md":
      console.log(`# 文件传输助手链接（${opts.since.toISOString()} ~ ${opts.until.toISOString()}）\n`);
      for (const r of deduped) {
        const title = r.title || r.url;
        console.log(`- [${title}](${r.url})`);
        console.log(`  > ${r.message_time}`);
      }
      break;
    case "text":
    default:
      console.log(`Found ${deduped.length} link(s):\n`);
      for (const r of deduped) {
        console.log(`[${r.message_time}] ${r.title || "(no title)"}`);
        console.log(`  ${r.url}`);
        console.log();
      }
      break;
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
