#!/usr/bin/env node
/**
 * setup.js — First-time initialization for wechat-filehelper-web-ingest.
 * Creates required local/ directories and validates that playwright is installed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

const LOCAL_DIRS = [
  "local/browser-profile",
  "local/index",
  "local/runs",
];

async function main() {
  console.log("wechat-filehelper-web-ingest: setup");
  console.log("=".repeat(50));

  // Create local/ directories
  for (const dir of LOCAL_DIRS) {
    const full = path.join(skillRoot, dir);
    await fs.mkdir(full, { recursive: true });
    console.log(`  ✓ ${dir}`);
  }

  // Check playwright is importable
  try {
    await import("playwright");
    console.log("  ✓ playwright is installed");
  } catch {
    console.error(
      "\n  ✗ playwright not found. Run: npm install\n"
    );
    process.exit(1);
  }

  console.log("\nSetup complete. Next step:");
  console.log(
    "  node scripts/scan-links.js --since 2026-03-22T15:00:00+08:00 --until 2026-03-22T23:59:59+08:00"
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
