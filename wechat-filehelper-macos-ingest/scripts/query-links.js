#!/usr/bin/env node
/**
 * query-links.js — Query the local JSONL index by time range.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatQueryUsage, parseQueryArgs, runQuery } from "./lib/query.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

async function main() {
  let opts;
  try {
    opts = parseQueryArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(formatQueryUsage());
    process.exit(1);
  }

  const result = await runQuery({
    skillRoot,
    since: opts.since,
    until: opts.until,
    format: opts.format,
  });
  console.log(result.rendered);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
