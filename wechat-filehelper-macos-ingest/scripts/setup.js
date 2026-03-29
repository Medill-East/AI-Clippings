#!/usr/bin/env node
/**
 * setup.js — First-time initialization for wechat-filehelper-macos-ingest.
 * Validates macOS environment, WeChat installation, UI-first runtime readiness,
 * store diagnostics, and creates required local dirs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyError, isWeChatRunning, runAppleScript } from "./lib/applescript.js";
import { probeVisionAvailability } from "./lib/ocr.js";
import { probeWeChatStore } from "./lib/store.js";
import { probeUiEnvironment } from "./lib/ui.js";

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

  if (process.platform !== "darwin") {
    console.error("\n  ✗ 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }
  console.log("  ✓ macOS detected");

  let wechatFound = false;
  for (const appPath of WECHAT_APP_PATHS) {
    try {
      await fs.access(appPath);
      wechatFound = true;
      console.log(`  ✓ WeChat.app found at ${appPath}`);
      break;
    } catch {
      // keep scanning
    }
  }
  if (!wechatFound) {
    console.error("\n  ✗ WeChat.app not found.");
    console.error("    Please install WeChat from https://weixin.qq.com/");
    process.exit(1);
  }

  if (isWeChatRunning()) {
    console.log("  ✓ WeChat is running");
  } else {
    console.log("  ⚠ WeChat is not currently running (scan-time only)");
  }

  const visionAvailable = await probeVisionAvailability();
  if (visionAvailable) {
    console.log("  ✓ Swift Vision OCR is available");
  } else {
    console.log("  ⚠ Swift Vision OCR is unavailable");
  }

  try {
    runAppleScript(
      'tell application "System Events" to tell process "WeChat" to get name of window 1'
    );
    console.log("  ✓ Accessibility permissions OK for clipboard fallback");
  } catch (err) {
    const classified = classifyError(err);
    if (classified.type === "accessibility") {
      console.log("  ⚠ Accessibility permissions missing for clipboard fallback");
      console.log("    系统设置 > 隐私与安全性 > 辅助功能");
      console.log("    添加你的终端应用（如 Warp、Terminal.app、iTerm2）。");
    } else if (classified.type === "not_running") {
      console.log("  ⚠ Cannot verify Accessibility fallback while WeChat is closed");
    } else {
      console.log(`  ⚠ Accessibility check inconclusive: ${classified.message}`);
    }
  }

  if (isWeChatRunning()) {
    console.log("  … probing UI-first readiness");
    const uiProbe = await probeUiEnvironment({ requireChatReady: false });
    if (uiProbe.ui_probe_status === "ready") {
      console.log("  ✓ UI-first scan path looks usable");
    } else {
      console.log(`  ⚠ UI-first path not fully ready: ${uiProbe.ui_probe_status}`);
    }
  } else {
    console.log("  ⚠ UI-first probe skipped because WeChat is not running");
  }

  console.log("  … probing local WeChat store");
  const probe = await probeWeChatStore();
  if (probe.store_probe_status === "readable") {
    console.log("  ✓ Local WeChat store looks directly readable");
  } else if (probe.store_probe_status === "encrypted_unreadable") {
    console.log("  ⚠ Local WeChat store exists but is not directly readable yet");
  } else {
    console.log("  ⚠ Local WeChat store is missing or incomplete");
  }

  for (const dir of LOCAL_DIRS) {
    const full = path.join(skillRoot, dir);
    await fs.mkdir(full, { recursive: true });
    console.log(`  ✓ ${dir}`);
  }

  console.log("\nSetup complete. Recommended next steps:");
  console.log("  1. Diagnose the UI-first path:");
  console.log("     node scripts/diagnose-filehelper.js --json");
  console.log("  2. Run a mixed-source scan:");
  console.log(
    "     node scripts/scan-links.js --since 2026-03-28T15:00:00+08:00 --until 2026-03-28T23:59:59+08:00 --source auto"
  );
  console.log("  3. If you need store diagnostics:");
  console.log("     node scripts/probe-store.js --json");
  console.log("  4. If you need AX diagnostics only:");
  console.log("     node scripts/inspect-accessibility.js");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
