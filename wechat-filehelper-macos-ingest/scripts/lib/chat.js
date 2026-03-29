/**
 * chat.js — WeChat macOS desktop navigation, scrolling, and message extraction
 * via macOS Accessibility API (JXA/AppleScript).
 *
 * NOTE: The exact AX element selectors depend on WeChat's actual accessibility tree.
 * Run `node scripts/inspect-accessibility.js` first to discover the structure,
 * then update references/wechat-macos-ax-tree.md with findings.
 * The selectors in this file are based on typical macOS chat app AX patterns
 * and may need adjustment after inspection.
 */

import {
  runJxa,
  runAppleScript,
  activateWeChat,
  sendKeystroke,
  sendKeyCode,
  typeText,
  sleepMs,
  isWeChatRunning,
  classifyError,
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
 * Navigate to the 文件传输助手 chat in WeChat desktop.
 * Strategy:
 *  1. Activate WeChat
 *  2. Use Cmd+F (search) to find the chat
 *  3. Type the chat name and press Enter
 *  4. Verify via AX tree that the correct chat is open
 */
export async function navigateToFileHelper(debug = false) {
  if (!isWeChatRunning()) {
    throw new Error("微信未运行。请先打开微信桌面版。");
  }

  activateWeChat();
  sleepMs(800);

  if (debug) console.log("[debug] Activating WeChat and opening search...");

  // Use Cmd+F to open search
  sendKeystroke("f", ["command down"]);
  sleepMs(600);

  // Type the chat name
  typeText(CHAT_NAME);
  sleepMs(800);

  // Press Enter to select the first result
  // Key code 36 = Return
  sendKeyCode(36);
  sleepMs(1000);

  // Verify we're in the right chat by checking the window title area
  const chatTitle = getCurrentChatTitle(debug);
  if (debug) console.log(`[debug] Current chat title: "${chatTitle}"`);

  if (chatTitle && !chatTitle.includes("文件传输助手") && chatTitle !== "") {
    // Try clicking search result directly
    if (debug) console.log("[debug] Title mismatch, trying to click first search result...");
    try {
      clickFirstSearchResult(debug);
      sleepMs(800);
    } catch (err) {
      if (debug) console.log("[debug] Click failed:", err.message);
    }
  }
}

/**
 * Get the title of the currently open chat by reading the AX tree.
 */
function getCurrentChatTitle(debug = false) {
  try {
    const result = runJxa(`
      const se = Application("System Events");
      const wechat = se.processes.byName("WeChat");
      const win = wechat.windows[0];

      // Try various known title element patterns
      function findTitle(el, depth) {
        if (depth > 6) return null;
        try {
          const role = el.role();
          const title = el.title() || "";
          const desc = el.description() || "";
          // Look for static text that could be a chat title
          if (role === "AXStaticText") {
            const val = String(el.value() || "");
            if (val.length > 0 && val.length < 50) return val;
          }
        } catch(e) {}
        try {
          const children = el.uiElements();
          for (let i = 0; i < children.length; i++) {
            const found = findTitle(children[i], depth + 1);
            if (found) return found;
          }
        } catch(e) {}
        return null;
      }

      // Try to find by checking AXTitle of window
      try {
        const title = win.title();
        if (title && title !== "WeChat") return title;
      } catch(e) {}

      // Walk the tree
      findTitle(win, 0) || "";
    `);
    return result.trim();
  } catch (err) {
    if (debug) console.log("[debug] getCurrentChatTitle error:", err.message);
    return "";
  }
}

/**
 * Click the first search result in WeChat.
 */
function clickFirstSearchResult(debug = false) {
  runJxa(`
    const se = Application("System Events");
    const wechat = se.processes.byName("WeChat");
    const win = wechat.windows[0];

    // Look for search result list items
    function findAndClick(el, depth) {
      if (depth > 8) return false;
      try {
        const role = el.role();
        // Click the first list row or group after search
        if (role === "AXRow" || role === "AXCell") {
          el.actions.byName("AXPress").perform();
          return true;
        }
      } catch(e) {}
      try {
        const children = el.uiElements();
        for (let i = 0; i < children.length; i++) {
          if (findAndClick(children[i], depth + 1)) return true;
        }
      } catch(e) {}
      return false;
    }

    findAndClick(win, 0);
  `);
}

/**
 * Extract all visible messages from the current WeChat chat view.
 *
 * Returns an array of message objects:
 * { timestampText: string|null, links: [{url, type, title}] }
 *
 * This implementation tries multiple strategies in order:
 * 1. AX tree traversal (preferred, structured)
 * 2. Clipboard text extraction (fallback)
 */
export function extractVisibleMessages(debug = false) {
  // Strategy 1: Try AX tree traversal
  try {
    const messages = extractViaAxTree(debug);
    if (messages.length > 0) {
      if (debug) console.log(`[debug] AX extraction found ${messages.length} message groups`);
      return messages;
    }
  } catch (err) {
    if (debug) console.log("[debug] AX extraction failed:", err.message);
  }

  // Strategy 2: Clipboard fallback
  if (debug) console.log("[debug] Falling back to clipboard extraction...");
  try {
    return extractViaClipboard(debug);
  } catch (err) {
    if (debug) console.log("[debug] Clipboard extraction failed:", err.message);
    return [];
  }
}

/**
 * Extract messages via Accessibility tree traversal.
 */
function extractViaAxTree(debug = false) {
  const rawJson = runJxa(`
    ObjC.import("stdlib");
    const se = Application("System Events");
    const wechat = se.processes.byName("WeChat");
    const win = wechat.windows[0];

    const URL_REGEX = /https?:\\/\\/[^\\s<>"'\\]]+/g;
    const messages = [];

    // Find the main scroll area (chat message list)
    function findScrollArea(el, depth) {
      if (depth > 8) return null;
      try {
        const role = el.role();
        if (role === "AXScrollArea") return el;
      } catch(e) {}
      try {
        const children = el.uiElements();
        for (let i = 0; i < children.length; i++) {
          const found = findScrollArea(children[i], depth + 1);
          if (found) return found;
        }
      } catch(e) {}
      return null;
    }

    // Extract text content from an element (recursive, up to depth 4)
    function extractText(el, depth) {
      if (depth > 4) return "";
      let text = "";
      try {
        const role = el.role();
        if (role === "AXStaticText" || role === "AXTextField" || role === "AXTextArea") {
          const val = String(el.value() || "");
          if (val) text += val + " ";
        }
        // AXLink may have a URL in its value
        if (role === "AXLink") {
          const val = String(el.value() || "");
          const url = String(el.url() || "");
          if (url) text += url + " ";
          if (val) text += val + " ";
        }
      } catch(e) {}
      try {
        const children = el.uiElements();
        for (let i = 0; i < children.length; i++) {
          text += extractText(children[i], depth + 1);
        }
      } catch(e) {}
      return text;
    }

    const scrollArea = findScrollArea(win, 0);
    if (!scrollArea) {
      JSON.stringify({ error: "Could not find scroll area" });
    } else {
      // Get direct children of scroll area (message groups)
      let children = [];
      try { children = scrollArea.uiElements(); } catch(e) {}

      let currentTimestamp = null;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        let role = "";
        try { role = child.role(); } catch(e) {}

        const text = extractText(child, 0);

        // Check if this looks like a timestamp separator
        const tsMatch = text.match(/^\\s*(\\d{1,2}:\\d{2}|今天|昨天|\\d+月\\d+日|\\d{4}年)/);
        if (tsMatch) {
          currentTimestamp = text.trim().substring(0, 30);
          continue;
        }

        // Extract URLs from the text
        const urls = [];
        const urlMatches = text.match(URL_REGEX) || [];
        for (const url of urlMatches) {
          // Clean trailing punctuation
          const cleanUrl = url.replace(/[.,;:!?)>]+$/, "");
          urls.push({ url: cleanUrl, type: "text_url", title: "" });
        }

        if (urls.length > 0) {
          messages.push({ timestampText: currentTimestamp, links: urls });
        }
      }

      JSON.stringify(messages);
    }
  `, { timeout: 45_000 });

  const parsed = JSON.parse(rawJson);
  if (parsed && parsed.error) {
    throw new Error(parsed.error);
  }
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Fallback: Extract messages by selecting all chat text via Cmd+A, Cmd+C,
 * then parsing URLs from the clipboard.
 */
function extractViaClipboard(debug = false) {
  // Focus the chat area first (click somewhere in the middle)
  try {
    runJxa(`
      const se = Application("System Events");
      const wechat = se.processes.byName("WeChat");
      wechat.windows[0].actions.byName("AXRaise").perform();
    `);
    sleepMs(300);
  } catch (err) {
    if (debug) console.log("[debug] Focus failed:", err.message);
  }

  // Select all and copy
  sendKeystroke("a", ["command down"]);
  sleepMs(300);
  sendKeystroke("c", ["command down"]);
  sleepMs(500);

  // Read clipboard
  const clipText = runJxa(`
    ObjC.import("AppKit");
    const pb = $.NSPasteboard.generalPasteboard;
    const str = pb.stringForType($.NSPasteboardTypeString);
    ObjC.unwrap(str) || "";
  `);

  return parseTextForLinks(clipText, debug);
}

/**
 * Parse a text blob (from clipboard or AX tree) for timestamps and URLs.
 */
function parseTextForLinks(text, debug = false) {
  const messages = [];
  const URL_REGEX = /https?:\/\/[^\s<>"'\]]+/g;

  // Split by lines and process
  const lines = text.split(/\n/);
  let currentTimestamp = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for timestamp patterns
    const tsPatterns = [
      /^(\d{1,2}:\d{2})$/,
      /^(今天\s+\d{1,2}:\d{2})$/,
      /^(昨天\s+\d{1,2}:\d{2})$/,
      /^(\d+月\d+日\s+\d{1,2}:\d{2})$/,
      /^(\d{4}年\d+月\d+日\s+\d{1,2}:\d{2})$/,
    ];

    let isTimestamp = false;
    for (const pattern of tsPatterns) {
      if (pattern.test(trimmed)) {
        currentTimestamp = trimmed;
        isTimestamp = true;
        break;
      }
    }
    if (isTimestamp) continue;

    // Extract URLs
    const urlMatches = trimmed.match(URL_REGEX) || [];
    for (const url of urlMatches) {
      const cleanUrl = url.replace(/[.,;:!?)>]+$/, "");
      messages.push({
        timestampText: currentTimestamp,
        links: [{ url: cleanUrl, type: "text_url", title: "" }],
      });
    }
  }

  return messages;
}

/**
 * Scroll the WeChat chat area up to load older messages.
 * Returns true if scroll likely succeeded.
 */
export function scrollUpOnce(debug = false) {
  try {
    // Try scrolling the scroll area via AX action
    const result = runJxa(`
      const se = Application("System Events");
      const wechat = se.processes.byName("WeChat");
      const win = wechat.windows[0];

      function findScrollArea(el, depth) {
        if (depth > 8) return null;
        try {
          if (el.role() === "AXScrollArea") return el;
        } catch(e) {}
        try {
          const children = el.uiElements();
          for (let i = 0; i < children.length; i++) {
            const found = findScrollArea(children[i], depth + 1);
            if (found) return found;
          }
        } catch(e) {}
        return null;
      }

      const sa = findScrollArea(win, 0);
      if (sa) {
        // Click on scroll area first to focus it
        try { sa.actions.byName("AXPress").perform(); } catch(e) {}
        "found";
      } else {
        "not_found";
      }
    `);

    if (result.trim() === "found") {
      // Page Up key (key code 116)
      sendKeyCode(116);
      sleepMs(400);
      return true;
    }
  } catch (err) {
    if (debug) console.log("[debug] AX scroll failed:", err.message);
  }

  // Fallback: just send Page Up to WeChat's foreground window
  try {
    sendKeyCode(116); // Page Up
    sleepMs(400);
    return true;
  } catch (err) {
    if (debug) console.log("[debug] Page Up fallback failed:", err.message);
    return false;
  }
}

/**
 * Main collection loop: scroll through chat history and collect links in [since, until].
 *
 * @param {Date} since - Start time (inclusive)
 * @param {Date} until - End time (inclusive)
 * @param {number} maxScrolls - Maximum scroll attempts
 * @param {boolean} debug - Verbose output
 * @returns {Array} Link records for the JSONL index
 */
export async function scrollAndCollect(since, until, maxScrolls, debug = false) {
  const sessionId = newCaptureSessionId();
  const now = new Date();
  const allRecords = [];
  const seenKeys = new Set();

  let scrollCount = 0;
  let consecutiveNoNew = 0;
  let earliestTimeSeen = null;

  if (debug) console.log(`[debug] Starting collection. Since=${since.toISOString()} Until=${until.toISOString()}`);

  while (scrollCount < maxScrolls) {
    const messages = extractVisibleMessages(debug);
    if (debug) console.log(`[debug] Scroll ${scrollCount}: extracted ${messages.length} message groups`);

    let foundAnyInRange = false;
    let foundBeforeRange = false;

    for (const msg of messages) {
      // Parse timestamp
      let messageTime = null;
      if (msg.timestampText) {
        try {
          messageTime = parseWeChatTimestamp(msg.timestampText, now);
        } catch (err) {
          if (debug) console.log(`[debug] Failed to parse timestamp "${msg.timestampText}":`, err.message);
        }
      }

      if (messageTime) {
        if (!earliestTimeSeen || messageTime < earliestTimeSeen) {
          earliestTimeSeen = messageTime;
        }
        if (messageTime < since) {
          foundBeforeRange = true;
          continue;
        }
        if (messageTime > until) continue;
        foundAnyInRange = true;
      }

      // Process links
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
          if (debug) console.log(`[debug] Skipping URL: ${canonical}`);
          continue;
        }

        const msgTimeStr = messageTime ? messageTime.toISOString() : now.toISOString();
        const key = dedupeKey(CHAT_NAME, msgTimeStr, canonical);

        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        allRecords.push({
          captured_at: now.toISOString(),
          message_time: msgTimeStr,
          chat_name: CHAT_NAME,
          message_type: link.type || "text_url",
          title: link.title || "",
          url: canonical,
          dedupe_key: key,
          capture_session_id: sessionId,
        });

        if (debug) console.log(`[debug] Found: ${canonical}`);
      }
    }

    // Stop if we've scrolled past the beginning of the time range
    if (foundBeforeRange && !foundAnyInRange) {
      if (debug) console.log("[debug] Reached before time range, stopping.");
      break;
    }

    // Detect no new content
    if (messages.length === 0) {
      consecutiveNoNew++;
      if (consecutiveNoNew >= 3) {
        if (debug) console.log("[debug] No new messages for 3 scrolls, stopping.");
        break;
      }
    } else {
      consecutiveNoNew = 0;
    }

    scrollCount++;
    if (scrollCount < maxScrolls) {
      scrollUpOnce(debug);
      sleepMs(500);
    }
  }

  if (debug) console.log(`[debug] Collection done. Scrolled ${scrollCount} times, found ${allRecords.length} records.`);
  return allRecords;
}
