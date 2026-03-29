#!/usr/bin/env node
/**
 * inspect-accessibility.js — Diagnostic tool to dump WeChat's macOS Accessibility tree.
 *
 * This script must be run on a real macOS machine with WeChat open.
 * It dumps the AX element hierarchy of the WeChat window to help discover
 * the UI structure for building the extraction logic.
 *
 * Usage:
 *   node scripts/inspect-accessibility.js [--depth N] [--window N]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runJxa,
  activateWeChat,
  isWeChatRunning,
  classifyError,
  sleepMs,
} from "./lib/applescript.js";
import { newRunTimestamp } from "./lib/common.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { depth: 8, windowIndex: 0 };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--depth":
        opts.depth = Math.min(15, Math.max(1, parseInt(args[++i], 10)));
        break;
      case "--window":
        opts.windowIndex = Math.max(0, parseInt(args[++i], 10) - 1);
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        console.error("Usage: node scripts/inspect-accessibility.js [--depth N] [--window N]");
        process.exit(1);
    }
  }
  return opts;
}

/**
 * JXA script that recursively walks the AX tree of a WeChat window.
 * Returns a JSON string of the tree structure.
 */
function buildJxaTreeWalker(windowIndex, maxDepth) {
  return `
    ObjC.import("stdlib");

    const se = Application("System Events");
    const wechat = se.processes.byName("WeChat");

    const windows = wechat.windows();
    if (windows.length === 0) {
      JSON.stringify({ error: "No WeChat windows found. Is WeChat open?" });
    } else {
      const targetIdx = Math.min(${windowIndex}, windows.length - 1);
      const win = windows[targetIdx];

      function walkElement(el, depth, maxDepth, index) {
        if (depth > maxDepth) return { role: "...", note: "max depth reached" };

        let role = "", title = "", value = "", desc = "", subrole = "";
        try { role = el.role(); } catch(e) {}
        try { title = el.title() || ""; } catch(e) {}
        try { value = String(el.value() || ""); } catch(e) {}
        try { desc = el.description() || ""; } catch(e) {}
        try { subrole = el.subrole() || ""; } catch(e) {}

        // Truncate long values
        if (value.length > 200) value = value.substring(0, 200) + "...";

        const node = {
          depth: depth,
          index: index,
          role: role,
          subrole: subrole || undefined,
          title: title || undefined,
          value: value || undefined,
          description: desc || undefined,
        };

        // Clean undefined fields
        Object.keys(node).forEach(k => { if (node[k] === undefined || node[k] === "") delete node[k]; });

        let children = [];
        try {
          const uiElements = el.uiElements();
          for (let i = 0; i < uiElements.length; i++) {
            children.push(walkElement(uiElements[i], depth + 1, maxDepth, i));
          }
        } catch(e) {}

        if (children.length > 0) node.children = children;
        return node;
      }

      const tree = walkElement(win, 0, ${maxDepth}, 0);
      JSON.stringify(tree);
    }
  `;
}

/**
 * Format the tree as indented text for readability.
 */
function formatTree(node, lines = [], indent = "") {
  const parts = [`[${node.role || "?"}]`];
  if (node.subrole) parts.push(`subrole=${node.subrole}`);
  if (node.title) parts.push(`title="${node.title}"`);
  if (node.description) parts.push(`desc="${node.description}"`);
  if (node.value) parts.push(`value="${node.value}"`);
  if (node.note) parts.push(`(${node.note})`);

  lines.push(`${indent}${parts.join("  ")}`);

  if (node.children) {
    for (const child of node.children) {
      formatTree(child, lines, indent + "  ");
    }
  }
  return lines;
}

/**
 * Count elements by role for summary.
 */
function countRoles(node, counts = {}) {
  const role = node.role || "unknown";
  counts[role] = (counts[role] || 0) + 1;
  if (node.children) {
    for (const child of node.children) {
      countRoles(child, counts);
    }
  }
  return counts;
}

async function main() {
  const opts = parseArgs(process.argv);

  console.log("WeChat macOS Accessibility Inspector");
  console.log("=".repeat(50));
  console.log(`Depth limit: ${opts.depth}`);
  console.log(`Window index: ${opts.windowIndex + 1}`);
  console.log();

  if (!isWeChatRunning()) {
    console.error("Error: WeChat is not running. Please open WeChat first.");
    process.exit(1);
  }

  console.log("Activating WeChat...");
  try {
    activateWeChat();
  } catch (err) {
    const { message } = classifyError(err);
    console.error(`Error activating WeChat: ${message}`);
    process.exit(1);
  }

  sleepMs(1000);

  console.log("Walking accessibility tree (this may take a moment)...\n");

  let tree;
  try {
    const jxa = buildJxaTreeWalker(opts.windowIndex, opts.depth);
    const result = runJxa(jxa, { timeout: 60_000 });
    tree = JSON.parse(result);
  } catch (err) {
    const { type, message } = classifyError(err);
    if (type === "accessibility") {
      console.error("Error: " + message);
      process.exit(1);
    }
    console.error("Error walking AX tree:", message);
    console.error("Raw error:", err.message);
    process.exit(1);
  }

  if (tree.error) {
    console.error("Error:", tree.error);
    process.exit(1);
  }

  // Format and display
  const lines = formatTree(tree);
  const output = lines.join("\n");

  console.log("--- AX Tree ---");
  console.log(output);
  console.log("--- End ---\n");

  // Summary
  const counts = countRoles(tree);
  console.log("Element count by role:");
  for (const [role, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role}: ${count}`);
  }

  // Save to file
  const runTs = newRunTimestamp();
  const runDir = path.join(skillRoot, "local/runs", runTs);
  await fs.mkdir(runDir, { recursive: true });

  const dumpPath = path.join(runDir, "ax-tree-dump.txt");
  await fs.writeFile(dumpPath, output + "\n", "utf8");

  const jsonPath = path.join(runDir, "ax-tree-dump.json");
  await fs.writeFile(jsonPath, JSON.stringify(tree, null, 2) + "\n", "utf8");

  console.log(`\nDump saved to:`);
  console.log(`  Text: local/runs/${runTs}/ax-tree-dump.txt`);
  console.log(`  JSON: local/runs/${runTs}/ax-tree-dump.json`);
  console.log(`\nUse this output to update references/wechat-macos-ax-tree.md`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
