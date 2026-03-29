/**
 * applescript.js — Helpers for running AppleScript and JXA (JavaScript for Automation)
 * via osascript on macOS.
 */

import { execFileSync, execSync } from "node:child_process";

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
 * Return the visible WeChat windows with bounds.
 */
export function getWeChatWindows() {
  try {
    const result = runJxa(`
      const se = Application("System Events");
      const process = se.processes.byName("WeChat");
      const windows = process.windows();
      JSON.stringify(windows.map((win, index) => {
        let pos = [0, 0];
        let size = [0, 0];
        let name = "";
        try { pos = win.position(); } catch (e) {}
        try { size = win.size(); } catch (e) {}
        try { name = win.name() || ""; } catch (e) {}
        return {
          index,
          name,
          x: Number(pos[0] || 0),
          y: Number(pos[1] || 0),
          width: Number(size[0] || 0),
          height: Number(size[1] || 0),
        };
      }));
    `);

    return JSON.parse(result)
      .filter((win) => win.width > 0 && win.height > 0)
      .sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

/**
 * Return the frontmost WeChat window.
 */
export function getFrontWeChatWindow() {
  return getWeChatWindows()[0] ?? null;
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
 * Send a keystroke to the current frontmost application.
 */
export function sendSystemKeystroke(key, modifiers = []) {
  const modStr = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  runAppleScript(`tell application "System Events" to keystroke "${key}"${modStr}`);
}

/**
 * Send a key code to the current frontmost application.
 */
export function sendSystemKeyCode(keyCode, modifiers = []) {
  const modStr = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  runAppleScript(`tell application "System Events" to key code ${keyCode}${modStr}`);
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
 * Click a screen coordinate.
 */
export function clickAtPoint(x, y, { processName = "WeChat", repeat = 1 } = {}) {
  const pointX = Math.round(x);
  const pointY = Math.round(y);
  const attempts = Math.max(1, repeat);

  try {
    runJxa(`
      ObjC.import("ApplicationServices");
      const point = { x: ${pointX}, y: ${pointY} };
      for (let i = 0; i < ${attempts}; i++) {
        const moveEvt = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
        $.CGEventPost($.kCGHIDEventTap, moveEvt);
        delay(0.03);
        const downEvt = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
        $.CGEventPost($.kCGHIDEventTap, downEvt);
        delay(0.03);
        const upEvt = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
        $.CGEventPost($.kCGHIDEventTap, upEvt);
        delay(0.08);
      }
    `);
  } catch {
    runJxa(`
      const se = Application("System Events");
      const process = se.processes.byName(${JSON.stringify(processName)});
      const point = [${pointX}, ${pointY}];
      for (let i = 0; i < ${attempts}; i++) {
        process.click({ at: point });
        delay(0.08);
      }
    `);
  }
}

/**
 * Scroll at a specific screen coordinate using native wheel events.
 * Positive lineDelta scrolls upward (toward older chat history).
 */
export function scrollAtPoint(x, y, { lineDelta = 4, repeat = 3 } = {}) {
  const pointX = Math.round(x);
  const pointY = Math.round(y);
  const delta = Math.round(lineDelta);
  const attempts = Math.max(1, repeat);

  runJxa(`
    ObjC.import("ApplicationServices");
    const point = { x: ${pointX}, y: ${pointY} };
    for (let i = 0; i < ${attempts}; i++) {
      const moveEvt = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvt);
      delay(0.02);
      const scrollEvt = $.CGEventCreateScrollWheelEvent(
        null,
        $.kCGScrollEventUnitLine,
        1,
        ${delta}
      );
      $.CGEventPost($.kCGHIDEventTap, scrollEvt);
      delay(0.06);
    }
  `);
}

/**
 * Read the current clipboard text.
 */
export function readClipboardText() {
  const result = runJxa(
    `
      ObjC.import("AppKit");
      const pb = $.NSPasteboard.generalPasteboard;
      JSON.stringify({
        text: ObjC.unwrap(pb.stringForType($.NSPasteboardTypeString)) || ""
      });
    `,
    { timeout: 5_000 }
  );
  return JSON.parse(result || '{"text":""}').text ?? "";
}

/**
 * Clear the current clipboard text.
 */
export function clearClipboardText() {
  runAppleScript('set the clipboard to ""');
}

/**
 * Return the frontmost process name.
 */
export function getFrontmostApplicationName() {
  try {
    return runAppleScript(
      'tell application "System Events" to name of first process whose frontmost is true'
    );
  } catch {
    return "";
  }
}

/**
 * Read the current browser URL by selecting the address bar and copying it.
 */
export function readFrontBrowserUrlFromAddressBar() {
  const before = readClipboardText();
  sendSystemKeystroke("l", ["command down"]);
  sleepMs(180);
  sendSystemKeystroke("c", ["command down"]);
  sleepMs(280);
  const after = readClipboardText();
  if (after && /^https?:\/\//i.test(after)) {
    return after;
  }
  if (after !== before && /^https?:\/\//i.test(after)) {
    return after;
  }
  return null;
}

/**
 * Capture a rectangle screenshot to a file.
 */
export function captureRectScreenshot(rect, outputPath) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  execFileSync("screencapture", ["-x", "-R", `${x},${y},${width},${height}`, outputPath], {
    timeout: DEFAULT_TIMEOUT_MS,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/**
 * Capture the current front WeChat window.
 */
export function captureWindowScreenshot(window, outputPath) {
  if (!window) {
    throw new Error("No WeChat window is available for screenshot capture.");
  }
  captureRectScreenshot(window, outputPath);
}

/**
 * Return the main desktop screen bounds in logical points.
 */
export function getMainScreenBounds() {
  const result = runAppleScript('tell application "Finder" to get bounds of window of desktop');
  const parts = String(result)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (parts.length !== 4) {
    throw new Error(`Unable to determine main screen bounds from Finder desktop bounds: ${result}`);
  }

  const [left, top, right, bottom] = parts;
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Capture the current main screen to a file and return the captured bounds.
 */
export function captureFullScreenScreenshot(outputPath) {
  const screenBounds = getMainScreenBounds();
  captureRectScreenshot(screenBounds, outputPath);
  return screenBounds;
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
