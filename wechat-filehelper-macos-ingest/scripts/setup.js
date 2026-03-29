#!/usr/bin/env node
/**
 * setup.js — First-time initialization for wechat-filehelper-macos-ingest.
 * Validates macOS environment, WeChat installation, Accessibility permissions,
 * and creates required local/ directories.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isWeChatRunning,
  runAppleScript,
  classifyError,
} from "./lib/applescript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

const LOCAL_DIRS = ["local/index", "local/runs"];

const WECHAT_APP_PATHS = [
  "/Applications/WeChat.app",
  `${process.env.HOME}/Applications/WeChat.app`,
];

async function main() {
  console.log("wechat-filehelper-macos-ingest: setup");
  console.log("=".repeat(50));

  // 1. Platform check
  if (process.platform !== "darwin") {
    console.error("\n  ✗ 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }
  console.log("  ✓ macOS detected");

  // 2. WeChat installed check
  let wechatFound = false;
  for (const p of WECHAT_APP_PATHS) {
    try {
      await fs.access(p);
      wechatFound = true;
      console.log(`  ✓ WeChat.app found at ${p}`);
      break;
    } catch {
      // not at this path
    }
  }
  if (!wechatFound) {
    console.error("\n  ✗ WeChat.app not found.");
    console.error("    Please install WeChat from https://weixin.qq.com/");
    process.exit(1);
  }

  // 3. Check if WeChat is running
  if (isWeChatRunning()) {
    console.log("  ✓ WeChat is running");
  } else {
    console.log("  ⚠ WeChat is not currently running (will need to be open for scan)");
  }

  // 4. Accessibility permissions check
  try {
    runAppleScript(
      'tell application "System Events" to tell process "WeChat" to get name of window 1'
    );
    console.log("  ✓ Accessibility permissions OK");
  } catch (err) {
    const classified = classifyError(err);
    if (classified.type === "accessibility") {
      console.error("\n  ✗ 辅助功能权限不足。");
      console.error("    请前往：系统设置 > 隐私与安全性 > 辅助功能");
      console.error("    添加你的终端应用（如 Warp、Terminal.app、iTerm2）。");
      process.exit(1);
    } else if (classified.type === "not_running") {
      console.log("  ⚠ Cannot test accessibility (WeChat not running).");
      console.log("    Please open WeChat and re-run setup to verify permissions.");
    } else {
      console.log(`  ⚠ Accessibility check inconclusive: ${classified.message}`);
    }
  }

  // 5. Create local/ directories
  for (const dir of LOCAL_DIRS) {
    const full = path.join(skillRoot, dir);
    await fs.mkdir(full, { recursive: true });
    console.log(`  ✓ ${dir}`);
  }

  console.log("\nSetup complete. Next steps:");
  console.log("  1. Open WeChat and navigate to 文件传输助手");
  console.log("  2. Run the AX tree inspector to discover UI structure:");
  console.log("     node scripts/inspect-accessibility.js");
  console.log("  3. Then run scan:");
  console.log(
    "     node scripts/scan-links.js --since 2026-03-28T15:00:00+08:00 --until 2026-03-28T23:59:59+08:00"
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
