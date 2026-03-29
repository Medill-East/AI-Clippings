/**
 * chat.js — Clipboard-based fallback extraction for macOS WeChat desktop.
 *
 * WeChat's Accessibility tree is nearly empty on current macOS builds, so this
 * module only serves as a fallback data source for visible plain-text URLs.
 */

import readline from "node:readline";

import {
  activateWeChat,
  clearClipboardText,
  getFrontmostApplicationName,
  readClipboardText,
  runJxa,
  scrollAtPoint,
  sendSystemKeystroke,
  sendSystemKeyCode,
  sleepMs,
  isWeChatRunning,
} from "./applescript.js";

import {
  canonicalizeUrl,
  classifySkipReason,
  dedupeKey,
  extractUrlsFromText,
  incrementCount,
  newCaptureSessionId,
  parseWeChatTimestamp,
} from "./common.js";

const CHAT_NAME = "文件传输助手";
export const FILE_HELPER_CHAT_NAME = CHAT_NAME;
const CHAT_ACTIVATE_SETTLE_MS = 320;
const CHAT_FOCUS_SETTLE_MS = 160;
const CHAT_CLICK_SETTLE_MS = 100;
const CHAT_COPY_SELECT_SETTLE_MS = 130;
const CHAT_COPY_CLIPBOARD_SETTLE_MS = 180;
const CHAT_SCROLL_SETTLE_MS = 160;

export function waitForUserReady() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\n请在微信中打开「文件传输助手」聊天，然后按 Enter 继续...");
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

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
  sleepMs(CHAT_ACTIVATE_SETTLE_MS);
}

function clickChatArea(debug = false) {
  const result = focusWeChatChatArea(debug);
  if (debug) console.log(`[debug] Clicked chat area at ${result.clickPoint}`);
  return result;
}

function activateAndClickChatArea() {
  return runJxa(`
    const se = Application("System Events");
    const wechat = se.processes.byName("WeChat");
    const wins = wechat.windows();
    if (wins.length === 0) { "no_window"; }
    else {
      const win = wins[0];
      let pos = [0, 0], sz = [800, 600];
      try { pos = win.position(); } catch(e) {}
      try { sz = win.size(); } catch(e) {}
      const x = Math.round(pos[0] + sz[0] * 0.62);
      const y = Math.round(pos[1] + sz[1] * 0.40);
      wechat.click({ at: [x, y] });
      x + "," + y;
    }
  `);
}

export function focusWeChatChatArea(
  debug = false,
  {
    activateWeChatFn = activateWeChat,
    activateAndClickChatAreaFn = activateAndClickChatArea,
    getFrontmostApplicationNameFn = getFrontmostApplicationName,
    sleepMsFn = sleepMs,
  } = {}
) {
  let clickPoint = "unknown";
  let frontmostApp = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    activateWeChatFn();
    sleepMsFn(CHAT_FOCUS_SETTLE_MS);
    clickPoint = activateAndClickChatAreaFn();
    sleepMsFn(CHAT_CLICK_SETTLE_MS);
    frontmostApp = getFrontmostApplicationNameFn();
    if (!frontmostApp || /wechat/i.test(frontmostApp)) {
      break;
    }
  }

  if (debug && frontmostApp) {
    console.log(`[debug] Frontmost app after focus: ${frontmostApp}`);
  }

  return { clickPoint, frontmostApp };
}

function copyVisibleMessages(debug = false) {
  if (debug) console.log("[debug] Click chat area, Cmd+A, Cmd+C...");
  clearClipboardText();
  clickChatArea(debug);
  sendSystemKeystroke("a", ["command down"]);
  sleepMs(CHAT_COPY_SELECT_SETTLE_MS);
  sendSystemKeystroke("c", ["command down"]);
  sleepMs(CHAT_COPY_CLIPBOARD_SETTLE_MS);
}

function parseClickPoint(value) {
  const [x, y] = String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function scrollUpOnce(
  debug = false,
  {
    focusWeChatChatAreaFn = focusWeChatChatArea,
    scrollAtPointFn = scrollAtPoint,
    sendSystemKeyCodeFn = sendSystemKeyCode,
    sleepMsFn = sleepMs,
  } = {}
) {
  if (debug) console.log("[debug] Scroll Up...");
  const { clickPoint } = focusWeChatChatAreaFn(debug);
  const parsedPoint = parseClickPoint(clickPoint);

  if (parsedPoint) {
    scrollAtPointFn(parsedPoint.x, parsedPoint.y, { lineDelta: 4, repeat: 3 });
    sleepMsFn(CHAT_SCROLL_SETTLE_MS);
    return;
  }

  for (let i = 0; i < 6; i += 1) {
    sendSystemKeyCodeFn(126); // Up Arrow
  }
  sleepMsFn(CHAT_SCROLL_SETTLE_MS);
}

export function extractShareCardTitle(line) {
  return String(line ?? "")
    .replace(/^\[(?:链接|link)\]\s*/i, "")
    .trim();
}

export function parseClipboardSnapshot(text, debug = false) {
  const stats = {
    share_cards_seen: 0,
    share_cards_unresolved: 0,
    skipped_by_rule: {},
  };

  if (!text || !text.trim()) {
    return { items: [], messages: [], stats };
  }

  const timestampPatterns = [
    /^(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(昨天\s+\d{1,2}:\d{2})/,
    /^(今天\s+\d{1,2}:\d{2})/,
    /^(\d{1,2}:\d{2})$/,
  ];

  const messages = [];
  const items = [];
  let currentTs = null;
  const lines = text.split(/\r?\n/);
  let itemIndex = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let matchedTimestamp = false;
    for (const pattern of timestampPatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      currentTs = match[1];
      matchedTimestamp = true;
      break;
    }
    if (matchedTimestamp) continue;

    if (looksLikeChatRecordBundle(line)) {
      incrementCount(stats.skipped_by_rule, "chat_record_bundle");
      items.push({
        kind: "chat_record_bundle",
        itemKey: `item-${itemIndex++}`,
        timestampText: currentTs,
        rawText: line,
        skipReason: "chat_record_bundle",
      });
      continue;
    }

    if (looksLikeShareCard(line)) {
      stats.share_cards_seen += 1;
      const title = extractShareCardTitle(line);
      let skipReason = null;

      if (looksLikeVideoCard(line)) {
        skipReason = "video_channel";
      } else if (looksLikeBilibiliCard(line)) {
        skipReason = "bilibili_video";
      } else if (looksLikeMultiArticleCard(line)) {
        skipReason = "multi_article_card";
      }

      if (skipReason) {
        incrementCount(stats.skipped_by_rule, skipReason);
      } else {
        stats.share_cards_unresolved += 1;
      }

      items.push({
        kind: "share_card",
        itemKey: `item-${itemIndex++}`,
        timestampText: currentTs,
        rawText: line,
        title,
        skipReason,
      });
      continue;
    }

    const urls = extractUrlsFromText(line);
    if (urls.length === 0) {
      continue;
    }

    const item = {
      kind: "text_url",
      itemKey: `item-${itemIndex++}`,
      timestampText: currentTs,
      links: urls.map((url) => ({ url, type: "text_url", title: "" })),
      rawText: line,
    };
    messages.push(item);
    items.push(item);
  }

  if (debug) {
    console.log(
      `[debug] Parsed ${messages.length} clipboard URL groups from ${lines.length} lines`
    );
  }

  return { items, messages, stats };
}

export function readVisibleClipboardSnapshot(debug = false) {
  copyVisibleMessages(debug);
  const text = readClipboardText();
  if (debug && text) console.log(`[debug] Clipboard: ${text.length} chars`);
  const parsed = parseClipboardSnapshot(text, debug);
  parsed.rawText = text;
  return parsed;
}

export function parseClipboardText(text, debug = false) {
  return parseClipboardSnapshot(text, debug);
}

export async function scanClipboardLinks(
  since,
  until,
  maxScrolls,
  debug = false,
  { getSnapshot = readVisibleClipboardSnapshot, scrollPage = scrollUpOnce } = {}
) {
  const sessionId = newCaptureSessionId();
  const now = new Date();
  const records = [];
  const seenKeys = new Set();
  const seenUrls = new Set();
  const stats = {
    source: "clipboard",
    share_cards_seen: 0,
    share_cards_unresolved: 0,
    skipped_by_rule: {},
  };

  let scrollCount = 0;
  let consecutiveNoNew = 0;
  let lastClipboardHash = "";

  if (debug) {
    console.log(`[debug] clipboard since=${since.toISOString()} until=${until.toISOString()}`);
  }

  while (scrollCount <= maxScrolls) {
    const snapshot = getSnapshot(debug);
    stats.share_cards_seen += snapshot.stats.share_cards_seen;
    stats.share_cards_unresolved += snapshot.stats.share_cards_unresolved;
    for (const [reason, count] of Object.entries(snapshot.stats.skipped_by_rule)) {
      incrementCount(stats.skipped_by_rule, reason, count);
    }

    const clipHash = snapshot.messages
      .map((message) => message.links.map((link) => link.url).join("|"))
      .join("||");
    if (clipHash === lastClipboardHash) {
      consecutiveNoNew += 1;
      if (consecutiveNoNew >= 3) {
        if (debug) console.log("[debug] Clipboard unchanged 3x, reached top or stuck.");
        break;
      }
    } else {
      consecutiveNoNew = 0;
      lastClipboardHash = clipHash;
    }

    let reachedBeforeRange = false;
    for (const message of snapshot.messages) {
      let messageTime = null;
      if (message.timestampText) {
        try {
          messageTime = parseWeChatTimestamp(message.timestampText, now);
        } catch {
          messageTime = null;
        }
      }

      if (messageTime) {
        if (messageTime < since) {
          reachedBeforeRange = true;
          continue;
        }
        if (messageTime > until) continue;
      }

      for (const link of message.links) {
        const canonicalUrl = canonicalizeUrl(link.url);
        const skipReason = classifySkipReason(canonicalUrl);
        if (skipReason) {
          incrementCount(stats.skipped_by_rule, skipReason);
          if (debug) console.log(`[debug] Skip: ${canonicalUrl} (${skipReason})`);
          continue;
        }

        if (seenUrls.has(canonicalUrl)) continue;
        seenUrls.add(canonicalUrl);

        const messageTimeIso = (messageTime ?? now).toISOString();
        const key = dedupeKey(CHAT_NAME, messageTimeIso, canonicalUrl);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        records.push({
          captured_at: new Date().toISOString(),
          message_time: messageTimeIso,
          chat_name: CHAT_NAME,
          message_type: "text_url",
          title: "",
          url: canonicalUrl,
          dedupe_key: key,
          capture_session_id: sessionId,
          source: "clipboard",
        });
      }
    }

    if (reachedBeforeRange) {
      if (debug) console.log("[debug] Passed 'since' boundary, stopping.");
      break;
    }

    scrollCount += 1;
    if (scrollCount <= maxScrolls) {
      scrollPage(debug);
    }
  }

  console.log(`Scrolled ${scrollCount} time(s), found ${records.length} unique link(s).`);
  return { records, stats };
}

function looksLikeShareCard(line) {
  return /^\[(?:链接|link)\]/i.test(line) || line.includes("[链接]") || /\[link\]/i.test(line);
}

function looksLikeChatRecordBundle(line) {
  return line.startsWith("聊天记录") || /^chat\s+(record|history)/i.test(line);
}

function looksLikeVideoCard(line) {
  return (
    line.includes("视频号") ||
    /video\s+channel/i.test(line) ||
    line.includes("channels.weixin.qq.com")
  );
}

function looksLikeBilibiliCard(line) {
  return line.includes("哔哩哔哩") || /bilibili|b23\.tv/i.test(line);
}

function looksLikeMultiArticleCard(line) {
  return (
    /共\s*\d+\s*篇/.test(line) ||
    line.includes("多图文") ||
    /\b\d+\s+articles?\b/i.test(line) ||
    /multiple\s+articles?/i.test(line)
  );
}
