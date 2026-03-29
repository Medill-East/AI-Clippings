#!/usr/bin/env node
/**
 * scan-links.js — Extract WeChat article links from File Transfer Assistant
 * via macOS desktop WeChat using UI-first scanning with clipboard fallback.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatScanUsage, parseScanArgs, runScan } from "./lib/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

async function main() {
  if (process.platform !== "darwin") {
    console.error("Error: 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }

  let opts;
  try {
    opts = parseScanArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(formatScanUsage());
    process.exit(1);
  }

  try {
    await runScan(opts, { skillRoot });
  } catch (err) {
    console.error("\nFatal error:", err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
