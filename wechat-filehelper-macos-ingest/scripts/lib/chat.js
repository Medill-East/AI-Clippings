/**
 * chat.js — WeChat macOS desktop message extraction via clipboard.
 *
 * WeChat uses a Qt-based rendering engine with a near-empty Accessibility tree.
 * Instead of AX tree traversal, we use:
 *   1. Cmd+A to select all visible messages in the current chat
 *   2. Cmd+C to copy to clipboard
 *   3. Parse the clipboard text for timestamps and URLs
 *   4. Page Up to scroll up and repeat
 *
 * The user must manually open 文件传输助手 before running scan-links.js.
 */

import {
  runJxa,
  activateWeChat,
  sendKeystroke,
  sendKeyCode,
  sleepMs,
  isWeChatRunning,
} from "./applescript.js";

import {
  canonicalizeUrl,
  shouldSkipUrl,
  dedupeKey,
  parseWeChatTimestamp,
  newCaptureSessionId,
} from "./common.js";

const CHAT_NAME = "文件传输助手";

/**
 * Activate WeChat and bring it to the foreground.
 * The user is responsible for having already navigated to 文件传输助手.
 */
export async function navigateToFileHelper(debug = false) {
  if (!isWeChatRunning()) {
    throw new Error("微信未运行。请先打开微信桌面版。");
  }
  if (debug) console.log("[debug] Activating WeChat...");
  activateWeChat();
  sleepMs(800);
}

/**
 * Read the current clipboard content as a string.
 */
function readClipboard() {
  return runJxa(`
    ObjC.import("AppKit");
    const pb = $.NSPasteboard.generalPasteboard;
    ObjC.unwrap(pb.stringForType($.NSPasteboardTypeString)) || "";
  `, { timeout: 5_000 });
}

/**
 * Select all visible chat messages and copy to clipboard.
 * Sends Cmd+A then Cmd+C to WeChat.
 */
function copyVisibleMessages(debug = false) {
  if (debug) console.log("[debug] Cmd+A, Cmd+C...");
  // Click in the chat area first by pressing a neutral key to ensure focus
  // then select all and copy
  sendKeystroke("a", ["command down"]);
  sleepMs(350);
  sendKeystroke("c", ["command down"]);
  sleepMs(600);
}

/**
 * Scroll the chat view up by one page.
 */
export function scrollUpOnce(debug = false) {
  if (debug) console.log("[debug] Page Up...");
  sendKeyCode(116); // Page Up
  sleepMs(700);
}

/**
 * Parse clipboard text for WeChat timestamps and URLs.
 *
 * WeChat's copied text format (typical):
 *   10:30
 *   Some message text https://example.com
 *   昨天 15:45
 *   [链接] Article title
 *   https://mp.weixin.qq.com/s/...
 *
 * Returns array of { timestampText, links: [{url, type, title}] }
 */
function parseClipboardText(text, debug = false) {
  if (!text || !text.trim()) return [];

  const URL_REGEX = /https?:\/\/[^\s\u4e00-\u9fff<>"'`）】\]]+/g;
  const TS_PATTERNS = [
    /^(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(昨天\s+\d{1,2}:\d{2})/,
    /^(今天\s+\d{1,2}:\d{2})/,
    /^(\d{1,2}:\d{2})$/,
  ];

  const lines = text.split(/\r?\n/);
  const groups = [];
  let currentTs = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Check for timestamp
    let matched = false;
    for (const pat of TS_PATTERNS) {
      const m = line.match(pat);
      if (m) {
        currentTs = m[1];
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Extract URLs from the line
    const urls = [...(line.matchAll(URL_REGEX) || [])].map(m => {
      // Clean trailing punctuation artifacts
      return m[0].replace(/[.,;:!?)\]>'"。，；：！？）】]+$/, "");
    }).filter(u => u.length > 10);

    if (urls.length > 0) {
      groups.push({
        timestampText: currentTs,
        links: urls.map(u => ({ url: u, type: "text_url", title: "" })),
      });
    }
  }

  if (debug) console.log(`[debug] Parsed ${groups.length} URL groups from ${lines.length} lines`);
  return groups;
}

/**
 * Extract visible messages from the current WeChat chat view via clipboard.
 */
export function extractVisibleMessages(debug = false) {
  copyVisibleMessages(debug);
  const text = readClipboard();
  if (debug && text) console.log(`[debug] Clipboard: ${text.length} chars`);
  return parseClipboardText(text, debug);
}

/**
 * Main collection loop: scroll through chat history and collect links in [since, until].
 *
 * @param {Date} since
 * @param {Date} until
 * @param {number} maxScrolls
 * @param {boolean} debug
 * @returns {Array} Link records for the JSONL index
 */
export async function scrollAndCollect(since, until, maxScrolls, debug = false) {
  const sessionId = newCaptureSessionId();
  const now = new Date();
  const allRecords = [];
  const seenKeys = new Set();
  const seenUrls = new Set(); // for dedup within a run

  let scrollCount = 0;
  let consecutiveNoNew = 0;
  let lastClipboardHash = "";

  if (debug) {
    console.log(`[debug] since=${since.toISOString()} until=${until.toISOString()}`);
  }

  while (scrollCount <= maxScrolls) {
    const messages = extractVisibleMessages(debug);

    // Detect no new content (clipboard unchanged)
    const clipHash = messages.map(m => m.links.map(l => l.url).join()).join("|");
    if (clipHash === lastClipboardHash) {
      consecutiveNoNew++;
      if (consecutiveNoNew >= 3) {
        if (debug) console.log("[debug] Clipboard unchanged 3x, reached top or stuck.");
        break;
      }
    } else {
      consecutiveNoNew = 0;
      lastClipboardHash = clipHash;
    }

    let reachedBeforeRange = false;

    for (const msg of messages) {
      let messageTime = null;
      if (msg.timestampText) {
        try {
          messageTime = parseWeChatTimestamp(msg.timestampText, now);
        } catch {
          // ignore parse errors
        }
      }

      if (messageTime && messageTime < since) {
        reachedBeforeRange = true;
        continue;
      }
      if (messageTime && messageTime > until) continue;

      for (const link of msg.links) {
        const rawUrl = link.url;
        if (!rawUrl) continue;

        let canonical;
        try {
          canonical = canonicalizeUrl(rawUrl);
        } catch {
          continue;
        }

        if (shouldSkipUrl(canonical)) {
          if (debug) console.log(`[debug] Skip: ${canonical}`);
          continue;
        }

        if (seenUrls.has(canonical)) continue;
        seenUrls.add(canonical);

        const msgTimeStr = messageTime ? messageTime.toISOString() : now.toISOString();
        const key = dedupeKey(CHAT_NAME, msgTimeStr, canonical);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        allRecords.push({
          captured_at: now.toISOString(),
          message_time: msgTimeStr,
          chat_name: CHAT_NAME,
          message_type: "text_url",
          title: "",
          url: canonical,
          dedupe_key: key,
          capture_session_id: sessionId,
        });

        if (debug) console.log(`[debug] +URL: ${canonical}`);
      }
    }

    if (reachedBeforeRange) {
      if (debug) console.log("[debug] Passed 'since' boundary, stopping.");
      break;
    }

    scrollCount++;
    if (scrollCount <= maxScrolls) {
      scrollUpOnce(debug);
    }
  }

  console.log(`Scrolled ${scrollCount} time(s), found ${allRecords.length} unique link(s).`);
  return allRecords;
}
