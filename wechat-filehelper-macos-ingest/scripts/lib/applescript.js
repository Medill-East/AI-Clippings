/**
 * applescript.js — Helpers for running AppleScript and JXA (JavaScript for Automation)
 * via osascript on macOS.
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run a short AppleScript snippet via `osascript -e`.
 * Best for one-liners. For complex scripts, use runJxa().
 */
export function runAppleScript(script, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return execSync(`osascript -e ${shellEscape(script)}`, {
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Run a JXA (JavaScript for Automation) script via stdin.
 * Avoids shell escaping issues for complex scripts.
 * Returns the stdout output as a string.
 */
export function runJxa(scriptBody, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return execSync("osascript -l JavaScript", {
    input: scriptBody,
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Check if WeChat is currently running.
 */
export function isWeChatRunning() {
  try {
    const result = runAppleScript(
      'tell application "System Events" to (name of every process) contains "WeChat"'
    );
    return result === "true";
  } catch {
    return false;
  }
}

/**
 * Activate WeChat (bring to foreground). Launches it if not running.
 */
export function activateWeChat() {
  runAppleScript('tell application "WeChat" to activate');
}

/**
 * Get the number of WeChat windows.
 */
export function getWeChatWindowCount() {
  try {
    const result = runAppleScript(
      'tell application "System Events" to tell process "WeChat" to count of windows'
    );
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Send a keystroke to the WeChat process.
 * @param {string} key - The key to press (e.g., "f", "a")
 * @param {string[]} modifiers - Modifiers like "command down", "shift down"
 */
export function sendKeystroke(key, modifiers = []) {
  const modStr = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  runAppleScript(
    `tell application "System Events" to tell process "WeChat" to keystroke "${key}"${modStr}`
  );
}

/**
 * Send a key code to the WeChat process.
 * @param {number} keyCode - The macOS key code
 * @param {string[]} modifiers - Modifiers like "command down"
 */
export function sendKeyCode(keyCode, modifiers = []) {
  const modStr = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  runAppleScript(
    `tell application "System Events" to tell process "WeChat" to key code ${keyCode}${modStr}`
  );
}

/**
 * Type text into the currently focused field in WeChat.
 */
export function typeText(text) {
  // Use JXA to avoid AppleScript string escaping issues with CJK characters
  runJxa(`
    const se = Application("System Events");
    const wechat = se.processes.byName("WeChat");
    se.keystroke(${JSON.stringify(text)}, { using: [] });
  `);
}

/**
 * Sleep for a given number of milliseconds (blocking).
 */
export function sleepMs(ms) {
  execSync(`sleep ${ms / 1000}`, { timeout: ms + 5000 });
}

/**
 * Classify an osascript error for better user-facing messages.
 * @param {Error} err
 * @returns {{ type: string, message: string }}
 */
export function classifyError(err) {
  const msg = err.message || err.stderr || "";
  if (msg.includes("not allowed assistive access") || msg.includes("accessibility")) {
    return {
      type: "accessibility",
      message:
        "辅助功能权限不足。请在 系统设置 > 隐私与安全性 > 辅助功能 中添加你的终端应用。",
    };
  }
  if (msg.includes("Application isn't running") || msg.includes("not running")) {
    return {
      type: "not_running",
      message: "微信未运行。请先打开微信桌面版。",
    };
  }
  if (msg.includes("timed out") || err.killed) {
    return {
      type: "timeout",
      message: "操作超时。请确保微信窗口可见且未被遮挡。",
    };
  }
  return { type: "unknown", message: msg };
}

/**
 * Escape a string for use as a single shell argument.
 */
function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
