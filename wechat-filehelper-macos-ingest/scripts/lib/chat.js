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

function matchClipboardTimestamp(line) {
  const timestampPatterns = [
    /^(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/,
    /^(昨天\s+\d{1,2}:\d{2})/,
    /^(今天\s+\d{1,2}:\d{2})/,
    /^(yesterday\s+\d{1,2}:\d{2})/i,
    /^(today\s+\d{1,2}:\d{2})/i,
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}:\d{2}$/i,
    /^(\d{1,2}:\d{2})$/,
  ];

  for (const pattern of timestampPatterns) {
    const match = String(line ?? "").match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function classifyStructuralShareCardSkipReason(text) {
  if (looksLikeVideoCard(text)) return "video_channel";
  if (looksLikeBilibiliCard(text)) return "bilibili_video";
  if (looksLikeMultiArticleCard(text)) return "multi_article_card";
  return null;
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const value = String(url ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildClipboardBlock({ blockId, timestampText, rawLines, stats }) {
  const normalizedLines = rawLines.map((line) => String(line ?? "").trim()).filter(Boolean);
  if (normalizedLines.length === 0) return null;

  const rawText = normalizedLines.join("\n");
  const shareCardLine = normalizedLines.find((line) => looksLikeShareCard(line)) ?? null;
  const shareCardTitle = shareCardLine ? extractShareCardTitle(shareCardLine) : null;
  const directUrls = uniqueUrls(normalizedLines.flatMap((line) => extractUrlsFromText(line)));

  let skipReason = null;
  if (normalizedLines.some((line) => looksLikeChatRecordBundle(line))) {
    skipReason = "chat_record_bundle";
    incrementCount(stats.skipped_by_rule, skipReason);
  } else if (shareCardTitle) {
    stats.share_cards_seen += 1;
    const structuralSkipReason = classifyStructuralShareCardSkipReason(rawText);
    if (structuralSkipReason && directUrls.length === 0) {
      skipReason = structuralSkipReason;
      incrementCount(stats.skipped_by_rule, skipReason);
    } else if (!structuralSkipReason && directUrls.length === 0) {
      stats.share_cards_unresolved += 1;
    }
  }

  return {
    blockId,
    timestampText,
    rawLines: normalizedLines,
    rawText,
    directUrls,
    shareCardTitle,
    skipReason,
  };
}

function buildSnapshotItemsFromBlocks(blocks) {
  const items = [];
  const messages = [];

  for (const block of blocks) {
    if (!block) continue;

    if (block.skipReason === "chat_record_bundle") {
      items.push({
        kind: "chat_record_bundle",
        itemKey: block.blockId,
        timestampText: block.timestampText,
        rawText: block.rawText,
        skipReason: block.skipReason,
      });
      continue;
    }

    if ((block.directUrls?.length ?? 0) > 0) {
      const item = {
        kind: "text_url",
        itemKey: block.blockId,
        timestampText: block.timestampText,
        links: block.directUrls.map((url) => ({
          url,
          type: "text_url",
          title: block.shareCardTitle ?? "",
        })),
        rawText: block.rawText,
        title: block.shareCardTitle ?? "",
      };
      items.push(item);
      messages.push(item);
      continue;
    }

    if (block.shareCardTitle) {
      items.push({
        kind: "share_card",
        itemKey: block.blockId,
        timestampText: block.timestampText,
        rawText: block.rawText,
        title: block.shareCardTitle,
        skipReason: block.skipReason,
      });
    }
  }

  return { items, messages };
}

export function parseClipboardSnapshot(text, debug = false) {
  const stats = {
    share_cards_seen: 0,
    share_cards_unresolved: 0,
    skipped_by_rule: {},
  };

  if (!text || !text.trim()) {
    return { items: [], messages: [], blocks: [], stats };
  }

  const blocks = [];
  let currentTs = null;
  let currentLines = [];
  const lines = text.split(/\r?\n/);
  let blockIndex = 0;

  const flushBlock = () => {
    if (currentLines.length === 0) return;
    const block = buildClipboardBlock({
      blockId: `block-${blockIndex++}`,
      timestampText: currentTs,
      rawLines: currentLines,
      stats,
    });
    if (block) {
      blocks.push(block);
    }
    currentLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushBlock();
      continue;
    }

    const matchedTimestamp = matchClipboardTimestamp(line);
    if (matchedTimestamp) {
      flushBlock();
      currentTs = matchedTimestamp;
      continue;
    }

    currentLines.push(line);
  }
  flushBlock();

  const { items, messages } = buildSnapshotItemsFromBlocks(blocks);

  if (debug) {
    console.log(
      `[debug] Parsed ${blocks.length} clipboard block(s), ${messages.length} direct URL group(s) from ${lines.length} lines`
    );
  }

  return { items, messages, blocks, stats };
}

export function readVisibleClipboardSnapshot(
  debug = false,
  {
    copyVisibleMessagesFn = copyVisibleMessages,
    readClipboardTextFn = readClipboardText,
    parseClipboardSnapshotFn = parseClipboardSnapshot,
  } = {}
) {
  let text = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    copyVisibleMessagesFn(debug);
    text = readClipboardTextFn();
    if (debug && text) console.log(`[debug] Clipboard: ${text.length} chars`);
    if (text?.trim()) break;
    if (debug && attempt === 0) {
      console.log("[debug] Clipboard empty after copy, retrying once...");
    }
  }

  const parsed = parseClipboardSnapshotFn(text, debug);
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
  const capturedAt = new Date();
  const referenceNow = until instanceof Date ? until : capturedAt;
  const records = [];
  const skippedRecords = [];
  const seenKeys = new Set();
  const seenUrls = new Set();
  const seenSkippedKeys = new Set();
  const stats = {
    source: "clipboard",
    share_cards_seen: 0,
    share_cards_unresolved: 0,
    skipped_by_rule: {},
  };

  function pushSkippedRecord({ messageTime, title = "", rawText = "", skipReason, rawUrl = "" }) {
    if (!skipReason) return;

    const messageTimeIso = (messageTime ?? referenceNow).toISOString();
    const dedupeBasis = rawUrl || title || rawText || skipReason;
    const key = dedupeKey(CHAT_NAME, messageTimeIso, `skip:${skipReason}:${dedupeBasis}`);
    if (seenSkippedKeys.has(key)) return;
    seenSkippedKeys.add(key);

    skippedRecords.push({
      captured_at: capturedAt.toISOString(),
      message_time: messageTimeIso,
      chat_name: CHAT_NAME,
      record_type: "skipped_card",
      title: title || rawUrl || "(untitled skipped card)",
      raw_text: rawText || rawUrl || "",
      skip_reason: skipReason,
      dedupe_key: key,
      capture_session_id: sessionId,
      source: "clipboard",
    });
  }

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

    const clipHash = (snapshot.blocks ?? [])
      .map((block) => `${block.timestampText ?? ""}|${block.rawText}|${(block.directUrls ?? []).join("|")}`)
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
    for (const block of snapshot.blocks ?? []) {
      let messageTime = null;
      if (block.timestampText) {
        try {
          messageTime = parseWeChatTimestamp(block.timestampText, referenceNow);
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

      for (const url of block.directUrls ?? []) {
        const canonicalUrl = canonicalizeUrl(url);
        const skipReason = classifySkipReason(canonicalUrl);
        if (skipReason) {
          incrementCount(stats.skipped_by_rule, skipReason);
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? canonicalUrl,
            rawText: block.rawText,
            skipReason,
            rawUrl: canonicalUrl,
          });
          if (debug) console.log(`[debug] Skip: ${canonicalUrl} (${skipReason})`);
          continue;
        }

        if (seenUrls.has(canonicalUrl)) continue;
        seenUrls.add(canonicalUrl);

        const messageTimeIso = (messageTime ?? referenceNow).toISOString();
        const key = dedupeKey(CHAT_NAME, messageTimeIso, canonicalUrl);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        records.push({
          captured_at: capturedAt.toISOString(),
          message_time: messageTimeIso,
          chat_name: CHAT_NAME,
          message_type: block.shareCardTitle ? "share_card" : "text_url",
          title: block.shareCardTitle ?? "",
          url: canonicalUrl,
          dedupe_key: key,
          capture_session_id: sessionId,
          source: "clipboard",
        });
      }

      if (block.skipReason) {
        pushSkippedRecord({
          messageTime,
          title: block.shareCardTitle ?? "",
          rawText: block.rawText,
          skipReason: block.skipReason,
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
  return { records, skippedRecords, stats };
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
  const text = String(line ?? "").normalize("NFKC");
  const hasBrand = text.includes("哔哩哔哩") || /bilibili|b23\.tv/i.test(text);
  const hasVideoIndicator =
    /UP主|播放[:：]|\bBV[0-9A-Za-z]{6,}\b|直播|番剧|投稿|av\d+/i.test(text);

  return /b23\.tv/i.test(text) || /\bBV[0-9A-Za-z]{6,}\b/.test(text) || (hasBrand && hasVideoIndicator);
}

function looksLikeMultiArticleCard(line) {
  return (
    /共\s*\d+\s*篇/.test(line) ||
    line.includes("多图文") ||
    /\b\d+\s+articles?\b/i.test(line) ||
    /multiple\s+articles?/i.test(line)
  );
}
