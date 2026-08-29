import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  activateWeChat,
  captureFullScreenScreenshot,
  captureRectScreenshot,
  captureWindowScreenshot,
  clearClipboardText,
  clickAtPoint,
  getFrontWeChatWindow,
  getWeChatChatWindow,
  getWeChatWindows,
  isWeChatRunning,
  readClipboardText,
  readFrontBrowserUrlFromAddressBar,
  sendKeyCode,
  sendKeystroke,
  sleepMs,
} from "./applescript.js";
import {
  FILE_HELPER_CHAT_NAME,
  navigateToFileHelper,
  readVisibleClipboardSnapshot,
  scrollUpOnce,
  waitForUserReady,
} from "./chat.js";
import {
  canonicalizeUrl,
  classifySkipReason,
  dedupeKey,
  extractUrlsFromText,
  incrementCount,
  newCaptureSessionId,
  parseWeChatTimestamp,
} from "./common.js";
import {
  createImageContentRecord,
  publishImageContentRecord,
} from "./image-content.js";
import { probeVisionAvailability, recognizeTextFromImage } from "./ocr.js";

const FILE_HELPER_NAMES = [
  FILE_HELPER_CHAT_NAME,
  "File Transfer Assistant",
  "File Transfer",
  "filehelper",
];
const COPY_LINK_LABELS = ["复制链接", "copy link"];
const OPEN_IN_BROWSER_LABELS = ["使用默认浏览器打开", "默认浏览器打开", "open in default browser"];
const VIEWER_MENU_PROBE_POINTS = [
  { xRatio: 0.955, yRatio: 0.022 },
  { xRatio: 0.94, yRatio: 0.022 },
  { xRatio: 0.97, yRatio: 0.022 },
  { xRatio: 0.955, yRatio: 0.032 },
  { xRatio: 0.94, yRatio: 0.032 },
];
const BILIBILI_BRAND_TOKENS = ["哔哩哔哩", "bilibili", "b23tv", "bolilbi", "bolibili", "bililbi", "blbl"];
const OCR_RIGHT_PANE_RATIO = 0.55;
const OCR_URL_CONTENT_LEFT_RATIO = 0.48;
const OCR_TOP_CONTENT_RATIO = 0.15;
const OCR_CLUSTER_GAP_PX = 54;
const OCR_TIMESTAMP_MIN_RATIO = 0.60;
const OCR_TIMESTAMP_MAX_RATIO = 0.82;
const OCR_TIMESTAMP_BEFORE_MAX_GAP_PX = 180;
const OCR_TIMESTAMP_AFTER_MAX_GAP_PX = 40;
const VIEWER_OPEN_SETTLE_MS = 160;
const VIEWER_DETECT_TIMEOUT_MS = 900;
const VIEWER_DETECT_POLL_MS = 60;
const VIEWER_READY_TIMEOUT_MS = 420;
const VIEWER_READY_POLL_MS = 40;
const IMAGE_VIEWER_READY_ATTEMPTS = 5;
const IMAGE_VIEWER_READY_POLL_MS = 180;
const VIEWER_MENU_SETTLE_MS = 45;
const VIEWER_COPY_SETTLE_MS = 0;
const VIEWER_BROWSER_SETTLE_MS = 500;
const VIEWER_CLOSE_INITIAL_SETTLE_MS = 5;
const VIEWER_CLOSE_ESCAPE_SETTLE_MS = 20;
const VIEWER_CLOSE_CMD_W_SETTLE_MS = 35;
const VIDEO_CHANNEL_SHARE_SETTLE_MS = 450;
const VIDEO_CHANNEL_SHARE_X_RATIO = 0.78;
const VIDEO_CHANNEL_SHARE_Y_RATIO = 0.93;
const OCR_CLUSTER_OPEN_RETRY_OFFSET_POINTS = 100;
const VIDEO_CHANNEL_VIEWER_LABELS = ["视频号", "channels"];
const VIEWER_RECOVERY_FAILURE_REASONS = new Set([
  "viewer_not_closed",
  "chat_not_recovered",
  "image_viewer_not_closed",
  "image_chat_not_recovered",
  "image_candidate_chat_not_recovered",
]);
const INCOMPLETE_TIMELINE_TERMINATIONS = new Set([
  "max_scrolls_reached",
  "max_candidates_reached",
  "candidate_generation_failed",
  "viewer_recovery_failed",
]);
const IMAGE_OCR_CANDIDATE_REASONS = new Set([
  "image_card",
  "plain_text_block",
  "weak_ocr_card",
]);

export function normalizeComparableText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[【】\[\]（）()、，。,:：;；.!！?？"'`~\-_/\\|]/g, "");
}

export function findFileHelperTitleLine(ocrLines, windowHeight = 0) {
  const titleZone = windowHeight > 0 ? windowHeight * 0.25 : Number.POSITIVE_INFINITY;
  const normalizedNames = FILE_HELPER_NAMES.map(normalizeComparableText);

  return (
    ocrLines.find((line) => {
      if (line.y > titleZone) return false;
      const normalized = normalizeComparableText(line.text);
      return normalizedNames.some(
        (name) => normalized.includes(name) || (normalized.length >= 4 && name.includes(normalized))
      );
    }) ?? null
  );
}

export function findMenuActionLine(ocrLines, labels) {
  const normalizedLabels = labels.map(normalizeComparableText);
  return (
    ocrLines.find((line) => {
      const normalized = normalizeComparableText(line.text);
      return normalizedLabels.some(
        (label) => normalized.includes(label) || (normalized.length >= 3 && label.includes(normalized))
      );
    }) ?? null
  );
}

export function looksLikeTimestampOcrText(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return (
    /^(\d{1,2}:\d{2})$/.test(value) ||
    /^(昨天|今天)\s+\d{1,2}:\d{2}$/.test(value) ||
    /^(yesterday|today)\s+\d{1,2}:\d{2}$/i.test(value) ||
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}:\d{2}$/i.test(value) ||
    /^(\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)$/.test(value) ||
    /^(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)$/.test(value)
  );
}

function inferDirectUrlItemsFromOcr(
  ocrLines,
  { imageWidth = 0, imageHeight = 0, timestampLines = [] } = {}
) {
  const contentTop = imageHeight * OCR_TOP_CONTENT_RATIO;
  const contentLeft = imageWidth * OCR_URL_CONTENT_LEFT_RATIO;
  const lines = (ocrLines ?? [])
    .filter(
      (line) =>
        line?.text &&
        line.y >= contentTop &&
        line.x >= contentLeft &&
        !looksLikeTimestampOcrText(line.text)
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const consumedLines = new Set();
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const anchor = lines[index];
    const normalizedAnchor = normalizeOcrUrlText(anchor.text);
    if (!/^https?:\/\//i.test(normalizedAnchor) || consumedLines.has(anchor)) continue;

    const cluster = [anchor];
    for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
      const previous = cluster[cluster.length - 1];
      const next = lines[index + offset];
      const verticalGap = next.y - (previous.y + previous.height);
      if (verticalGap > Math.max(previous.height, next.height) * 1.4) break;
      if (Math.abs(next.x - anchor.x) > imageWidth * 0.12) break;
      cluster.push(next);
    }

    const rawLines = cluster.map((line) => line.text);
    if (extractOcrUrlEntries(rawLines).length === 0) continue;
    for (const line of cluster) consumedLines.add(line);
    const timestampLine = findNearestTimestampLine(anchor, timestampLines);
    items.push({
      kind: "text_url",
      itemKey: `ocr-url-${items.length}`,
      timestampText: timestampLine?.text ?? null,
      rawText: rawLines.join(" "),
      title: "",
      skipReason: null,
      ocrCluster: cluster,
    });
  }

  return { items, consumedLines };
}

export function inferShareCardItemsFromOcr(ocrLines, { imageWidth = 0, imageHeight = 0 } = {}) {
  const rightBoundary = imageWidth * OCR_RIGHT_PANE_RATIO;
  const topBoundary = imageHeight * OCR_TOP_CONTENT_RATIO;
  const timestampTopBoundary = imageHeight * 0.08;
  const timestampMinX = imageWidth * OCR_TIMESTAMP_MIN_RATIO;
  const timestampMaxX = imageWidth * OCR_TIMESTAMP_MAX_RATIO;
  const candidateLines = [];
  const timestampLines = [];

  for (const line of ocrLines) {
    if (!line?.text) continue;

    const centerX = line.x + line.width / 2;
    if (
      looksLikeTimestampOcrText(line.text) &&
      line.y >= timestampTopBoundary &&
      centerX >= timestampMinX &&
      centerX <= timestampMaxX
    ) {
      timestampLines.push(line);
      continue;
    }

    if (line.y < topBoundary) continue;

    if (line.x < rightBoundary) continue;
    candidateLines.push(line);
  }
  const directUrlResult = inferDirectUrlItemsFromOcr(ocrLines, {
    imageWidth,
    imageHeight,
    timestampLines,
  });
  const shareCardCandidateLines = candidateLines.filter(
    (line) => !directUrlResult.consumedLines.has(line)
  );

  const clusters = [];
  let currentCluster = [];
  for (const line of shareCardCandidateLines) {
    const previous = currentCluster[currentCluster.length - 1];
    if (
      previous &&
      line.y - (previous.y + previous.height) > OCR_CLUSTER_GAP_PX
    ) {
      clusters.push(currentCluster);
      currentCluster = [];
    }
    currentCluster.push(line);
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }
  timestampLines.sort((a, b) => a.y - b.y);

  const items = [...directUrlResult.items];
  let index = items.length;
  for (const cluster of clusters) {
    const rawLines = cluster.map((line) => String(line?.text ?? "").trim()).filter(Boolean);
    const rawText = rawLines.join(" ").trim();
    if (!rawText) continue;
    if (cluster.length < 2 && !looksLikeImageCardText(rawLines, rawText)) continue;

    const title = cluster
      .slice(0, Math.min(cluster.length, 2))
      .map((line) => line.text)
      .join(" ")
      .trim();
    const timestampLine = findNearestTimestampLine(cluster[0], timestampLines);
    const classificationReason = classifyOcrShareCardSkipReason(rawText, rawLines);
    const contentType = IMAGE_OCR_CANDIDATE_REASONS.has(classificationReason) ? "image" : null;
    const skipReason = contentType === "image" ? null : classificationReason;

    items.push({
      kind: "share_card",
      itemKey: `ocr-item-${index++}`,
      timestampText: timestampLine?.text ?? null,
      rawText,
      title,
      skipReason,
      contentType,
      classificationReason,
      ocrCluster: cluster,
    });
  }

  return items;
}

function findNearestTimestampLine(clusterTopLine, timestampLines) {
  if (timestampLines.length === 0) return null;

  let before = null;
  let after = null;
  for (const line of timestampLines) {
    if (line.y <= clusterTopLine.y) {
      if (clusterTopLine.y - line.y <= OCR_TIMESTAMP_BEFORE_MAX_GAP_PX) {
        before = line;
      }
      continue;
    }
    if (line.y - clusterTopLine.y <= OCR_TIMESTAMP_AFTER_MAX_GAP_PX) {
      after = line;
    }
    break;
  }

  return before ?? after ?? null;
}

function classifyOcrShareCardSkipReason(rawText, rawLines = []) {
  if (/视频号|video\s+channel/i.test(rawText)) return "video_channel";
  if (looksLikeBilibiliVideoText(rawText)) return "bilibili_video";
  if (/共\s*\d+\s*篇|\b\d+\s+articles?\b|multiple\s+articles?/i.test(rawText)) {
    return "multi_article_card";
  }
  if (looksLikeImageCardText(rawLines, rawText)) return "image_card";
  if (looksLikePlainTextImageCandidate(rawLines, rawText)) return "plain_text_block";
  if (looksLikeWeakImageCandidate(rawLines, rawText)) return "weak_ocr_card";
  return null;
}

function normalizeRawLines(rawLines, rawText = "") {
  return Array.isArray(rawLines)
    ? rawLines.map((line) => String(line ?? "").normalize("NFKC").trim()).filter(Boolean)
    : String(rawText ?? "")
        .normalize("NFKC")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function looksLikeImageCardText(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  const text = lines.join(" ").trim();
  return /^(?:\[?\s*)?(?:一张|多张)?(?:图片|照片|image|photo)(?:\s*\]?)?$/i.test(text);
}

function looksLikePlainTextImageCandidate(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  if (lines.length < 3) return false;
  if (lines.some((line) => looksLikeTimestampOcrText(line) || looksLikeUrlLikeText(line))) return false;
  if (/视频号|video\s+channel/i.test(rawText) || looksLikeBilibiliVideoText(rawText)) return false;

  const text = lines.join(" ");
  const normalizedLength = normalizeComparableText(text).length;
  const sentencePunctuationCount = (text.match(/[。！？；]/g) ?? []).length;
  const commaCount = (text.match(/[，,]/g) ?? []).length;
  return normalizedLength >= 28 && (sentencePunctuationCount >= 2 || commaCount >= 3);
}

function looksLikeWeakImageCandidate(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  if (lines.length === 0 || lines.length > 2) return false;
  if (lines.some((line) => looksLikeTimestampOcrText(line) || looksLikeUrlLikeText(line))) return false;
  if (/视频号|video\s+channel/i.test(rawText) || looksLikeBilibiliVideoText(rawText)) return false;
  const combined = lines.map(normalizeComparableText).join("");
  return combined.length > 0 && combined.length <= 8;
}

export function mapOcrRectCenterToScreenPoint(windowBounds, rect, ocrResult = null) {
  const imageWidth = Number(ocrResult?.width ?? windowBounds?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? windowBounds?.height ?? 0);
  const scaleX =
    imageWidth > 0 && Number(windowBounds?.width ?? 0) > 0 ? windowBounds.width / imageWidth : 1;
  const scaleY =
    imageHeight > 0 && Number(windowBounds?.height ?? 0) > 0 ? windowBounds.height / imageHeight : 1;

  return {
    x: Math.round(windowBounds.x + (rect.x + rect.width / 2) * scaleX),
    y: Math.round(windowBounds.y + (rect.y + rect.height / 2) * scaleY),
  };
}

function normalizeSnapshotBlocks(clipboardSnapshot = {}) {
  if (Array.isArray(clipboardSnapshot.blocks)) {
    return clipboardSnapshot.blocks.map((block, index) => {
      const directUrlEntries = normalizeDirectUrlEntries(
        block?.directUrlEntries,
        block?.directUrls,
        "clipboard_explicit"
      );
      const classification = normalizeBlockContentClassification(block);

      return {
        ...block,
        blockId: block?.blockId ?? `block-${index}`,
        directUrls: directUrlEntries
          .filter((entry) => entry.confidence === "confirmed")
          .map((entry) => entry.url),
        directUrlEntries,
        ...classification,
      };
    });
  }

  const items = Array.isArray(clipboardSnapshot.items) ? clipboardSnapshot.items : [];
  return items.map((item, index) => {
    const classification = normalizeBlockContentClassification(item);
    return {
      blockId: item.blockId ?? item.itemKey ?? `item-${index}`,
      timestampText: item.timestampText ?? null,
      rawLines: String(item.rawText ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      rawText: item.rawText ?? "",
      directUrls: item.kind === "text_url" ? (item.links ?? []).map((link) => link.url) : [],
      directUrlEntries:
        item.kind === "text_url"
          ? normalizeDirectUrlEntries(
              (item.links ?? []).map((link) => ({
                url: link.url,
                confidence: "confirmed",
                confidenceReason: "clipboard_explicit",
              })),
              [],
              "clipboard_explicit"
            )
          : [],
      shareCardTitle:
        item.kind === "share_card" ? item.title ?? "" : item.title?.trim() ? item.title.trim() : null,
      ...classification,
    };
  });
}

function normalizeBlockContentClassification(block) {
  const classificationReason = block?.classificationReason ?? block?.skipReason ?? null;
  const contentType =
    block?.contentType === "image" || IMAGE_OCR_CANDIDATE_REASONS.has(classificationReason)
      ? "image"
      : block?.contentType ?? null;

  return {
    contentType,
    classificationReason:
      contentType === "image" ? classificationReason : block?.classificationReason ?? null,
    skipReason: contentType === "image" ? null : block?.skipReason ?? null,
  };
}

function blockToSnapshotItem(block) {
  if (!block) return null;

  if (block.skipReason === "chat_record_bundle") {
    return {
      kind: "chat_record_bundle",
      itemKey: block.blockId,
      timestampText: block.timestampText,
      rawText: block.rawText,
      skipReason: block.skipReason,
    };
  }

  const directUrlEntries = getBlockDirectUrlEntries(block);
  if (directUrlEntries.length > 0) {
    return {
      kind: "text_url",
      itemKey: block.blockId,
      timestampText: block.timestampText,
      links: directUrlEntries.map((entry) => ({
        url: entry.url,
        type: "text_url",
        title: block.shareCardTitle ?? "",
      })),
      rawText: block.rawText,
      title: block.shareCardTitle ?? "",
    };
  }

  if (block.shareCardTitle) {
    return {
      kind: "share_card",
      itemKey: block.blockId,
      timestampText: block.timestampText,
      rawText: block.rawText,
      title: block.shareCardTitle,
      skipReason: block.skipReason ?? null,
      ...(block.contentType ? { contentType: block.contentType } : {}),
      ...(block.classificationReason ? { classificationReason: block.classificationReason } : {}),
    };
  }

  return null;
}

function ocrFallbackItemToBlock(item) {
  const rawLines = Array.isArray(item?.ocrCluster)
    ? item.ocrCluster.map((line) => String(line?.text ?? "").trim()).filter(Boolean)
    : String(item.rawText ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const rawText = rawLines.join("\n");
  const directUrlEntries = extractOcrUrlEntries(rawLines);
  const directUrls = directUrlEntries
    .filter((entry) => entry.confidence === "confirmed")
    .map((entry) => entry.url);

  return {
    blockId: item.itemKey,
    timestampText: item.timestampText ?? null,
    rawLines,
    rawText,
    directUrls,
    directUrlEntries,
    shareCardTitle: directUrlEntries.length > 0 ? null : item.title ?? "",
    skipReason: directUrlEntries.length > 0 ? null : item.skipReason ?? null,
    contentType: directUrlEntries.length > 0 ? null : item.contentType ?? null,
    classificationReason: item.classificationReason ?? null,
    ocrCluster: item.ocrCluster ?? [],
  };
}

function emptyClipboardSnapshot() {
  return {
    rawText: "",
    items: [],
    messages: [],
    blocks: [],
    stats: {
      share_cards_seen: 0,
      share_cards_unresolved: 0,
      skipped_by_rule: {},
    },
  };
}

function normalizeUrlLikeText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、“”"'`<>【】（）()\[\]]/g, "");
}

function normalizeOcrUrlText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u200B\u00A0]/g, "")
    .replace(/[“”‘’]/g, "")
    .replace(/：/g, ":")
    .replace(/；/g, ":")
    .replace(/？/g, "?")
    .replace(/／/g, "/")
    .replace(/\s+/g, "");
}

function addOcrUrlVariant(variants, rawText, score) {
  const normalized = normalizeOcrUrlText(rawText);
  if (!normalized) return;
  variants.push({ text: normalized, score });
}

function buildDirectUrlEntry(url, confidence, confidenceReason) {
  return {
    url: canonicalizeUrl(url),
    confidence,
    confidenceReason,
  };
}

function normalizeDirectUrlEntries(entries = [], fallbackUrls = [], defaultConfidenceReason = "clipboard_explicit") {
  const normalized = [];
  const seen = new Set();

  const addEntry = (entryLike, fallbackConfidence = "confirmed") => {
    const rawUrl =
      typeof entryLike === "string"
        ? entryLike
        : entryLike?.url;
    if (!rawUrl) return;

    const canonicalUrl = canonicalizeUrl(rawUrl);
    const dedupeKey = `${entryLike?.confidence ?? fallbackConfidence}|${canonicalUrl}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({
      url: canonicalUrl,
      confidence: entryLike?.confidence ?? fallbackConfidence,
      confidenceReason: entryLike?.confidenceReason ?? defaultConfidenceReason,
    });
  };

  for (const entry of entries ?? []) {
    addEntry(entry, "confirmed");
  }
  for (const url of fallbackUrls ?? []) {
    addEntry(url, "confirmed");
  }

  return normalized;
}

function getBlockDirectUrlEntries(block) {
  return normalizeDirectUrlEntries(block?.directUrlEntries, block?.directUrls, "clipboard_explicit");
}

function getBlockConfirmedDirectUrls(block) {
  return getBlockDirectUrlEntries(block)
    .filter((entry) => entry.confidence === "confirmed")
    .map((entry) => entry.url);
}

function buildOcrUrlVariants(rawLines) {
  const variants = [];
  addOcrUrlVariant(variants, rawLines.join(""), 5);
  addOcrUrlVariant(variants, rawLines.join(" "), 4);

  for (let index = 0; index < rawLines.length; index++) {
    addOcrUrlVariant(variants, rawLines[index], 2);

    if (index + 1 < rawLines.length) {
      addOcrUrlVariant(variants, `${rawLines[index]}${rawLines[index + 1]}`, 6);
      addOcrUrlVariant(variants, `${rawLines[index]} ${rawLines[index + 1]}`, 5);
    }
  }

  return variants;
}

function buildOcrUrlMetadata(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const queryKeys = [...parsed.searchParams.keys()].sort();
    return {
      url: rawUrl,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      queryKeys,
    };
  } catch {
    return {
      url: rawUrl,
      origin: "",
      pathname: "",
      search: "",
      queryKeys: [],
    };
  }
}

function isTruncatedUrlPrefix(candidate, preferred) {
  const candidateMeta = buildOcrUrlMetadata(candidate);
  const preferredMeta = buildOcrUrlMetadata(preferred);
  if (!candidateMeta.origin || candidateMeta.origin !== preferredMeta.origin) return false;
  if (!preferred.startsWith(candidate)) return false;

  const nextChar = preferred.slice(candidate.length, candidate.length + 1);
  return (
    candidate.endsWith("-") ||
    nextChar === "/" ||
    nextChar === "?" ||
    nextChar === "&" ||
    nextChar === "="
  );
}

function countCharDifferences(left, right) {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let diffs = 0;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) diffs += 1;
    if (diffs > 1) return diffs;
  }
  return diffs;
}

function areNearDuplicateOcrUrls(left, right) {
  const leftMeta = buildOcrUrlMetadata(left);
  const rightMeta = buildOcrUrlMetadata(right);
  if (!leftMeta.origin || leftMeta.origin !== rightMeta.origin) return false;
  if (leftMeta.pathname !== rightMeta.pathname) return false;
  if (leftMeta.queryKeys.join("|") !== rightMeta.queryKeys.join("|")) return false;

  if (!leftMeta.search && !rightMeta.search) {
    const leftLeaf = leftMeta.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const rightLeaf = rightMeta.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return leftLeaf.length > 0 && countCharDifferences(leftLeaf, rightLeaf) <= 1;
  }

  try {
    const leftParsed = new URL(left);
    const rightParsed = new URL(right);
    for (const key of leftMeta.queryKeys) {
      const leftValue = leftParsed.searchParams.get(key) ?? "";
      const rightValue = rightParsed.searchParams.get(key) ?? "";
      if (leftValue === rightValue) continue;
      if (countCharDifferences(leftValue, rightValue) > 1) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function choosePreferredOcrUrl(left, right) {
  if ((left.count ?? 0) !== (right.count ?? 0)) {
    return (left.count ?? 0) > (right.count ?? 0) ? left : right;
  }
  if ((left.score ?? 0) !== (right.score ?? 0)) {
    return (left.score ?? 0) > (right.score ?? 0) ? left : right;
  }
  if (left.url.length !== right.url.length) {
    return left.url.length > right.url.length ? left : right;
  }
  return left.url <= right.url ? left : right;
}

function isMalformedOcrUrl(url) {
  return (String(url ?? "").match(/https?:\/\//g) ?? []).length > 1;
}

function haveConflictingOcrUrls(left, right) {
  if (left === right) return false;
  const leftMeta = buildOcrUrlMetadata(left);
  const rightMeta = buildOcrUrlMetadata(right);
  if (!leftMeta.origin || leftMeta.origin !== rightMeta.origin) return false;
  if (leftMeta.pathname !== rightMeta.pathname) return false;
  return leftMeta.queryKeys.join("|") === rightMeta.queryKeys.join("|");
}

function hasSuspiciousOcrUrlTail(url) {
  try {
    const parsed = new URL(url);
    for (const [, value] of parsed.searchParams) {
      if (/[A-Za-z0-9]{4,}\.[A-Za-z]{4,}$/i.test(value)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function hasStandaloneTerminalPeriod(rawLines, url) {
  return rawLines.some((line) => {
    const text = String(line ?? "").trim();
    if (!/^https?:\/\/\S+\.$/i.test(text)) return false;
    return extractUrlsFromText(text).some(
      (extractedUrl) => canonicalizeUrl(extractedUrl) === url,
    );
  });
}

function extractOcrUrlEntries(linesOrText) {
  const rawLines = Array.isArray(linesOrText)
    ? linesOrText.map((line) => String(line ?? "").trim()).filter(Boolean)
    : String(linesOrText ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

  if (rawLines.length === 0) return [];

  const variants = buildOcrUrlVariants(rawLines);
  const extracted = new Map();

  for (const variant of variants) {
    for (const rawUrl of extractUrlsFromText(variant.text)) {
      if (isMalformedOcrUrl(rawUrl)) continue;
      const url = canonicalizeUrl(rawUrl);
      const existing = extracted.get(url);
      if (existing) {
        existing.count += 1;
        existing.score = Math.max(existing.score, variant.score);
      } else {
        extracted.set(url, { url, score: variant.score, count: 1 });
      }
    }
  }

  const candidates = [...extracted.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.count !== left.count) return right.count - left.count;
    return right.url.length - left.url.length;
  });
  const reasonsByUrl = new Map();

  function addReason(url, reason) {
    if (!reasonsByUrl.has(url)) reasonsByUrl.set(url, new Set());
    reasonsByUrl.get(url).add(reason);
  }

  for (const candidate of candidates) {
    if (isMalformedOcrUrl(candidate.url)) addReason(candidate.url, "malformed_url");
    if (hasSuspiciousOcrUrlTail(candidate.url)) addReason(candidate.url, "suspicious_tail");
    if (hasStandaloneTerminalPeriod(rawLines, candidate.url)) {
      addReason(candidate.url, "terminal_period");
    }
  }

  for (let index = 0; index < candidates.length; index++) {
    for (let otherIndex = 0; otherIndex < candidates.length; otherIndex++) {
      if (index === otherIndex) continue;
      if (isTruncatedUrlPrefix(candidates[index].url, candidates[otherIndex].url)) {
        addReason(candidates[index].url, "truncated_prefix");
      }
    }
  }

  for (let index = 0; index < candidates.length; index++) {
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex++) {
      const current = candidates[index];
      const other = candidates[otherIndex];
      if (!areNearDuplicateOcrUrls(current.url, other.url) && !haveConflictingOcrUrls(current.url, other.url)) {
        continue;
      }
      const preferred = choosePreferredOcrUrl(current, other);
      const alternate = preferred.url === current.url ? other : current;
      addReason(alternate.url, areNearDuplicateOcrUrls(current.url, other.url) ? "near_duplicate_variant" : "conflicting_variant");
    }
  }

  const confirmed = [];
  const uncertain = [];
  for (const candidate of candidates) {
    const reasons = [...(reasonsByUrl.get(candidate.url) ?? [])];
    if (reasons.length === 0) {
      confirmed.push(buildDirectUrlEntry(candidate.url, "confirmed", "ocr_unique"));
      continue;
    }
    uncertain.push(buildDirectUrlEntry(candidate.url, "uncertain", reasons[0]));
  }

  return normalizeDirectUrlEntries([...confirmed, ...uncertain], [], "ocr_unique");
}

function looksLikeBilibiliVideoText(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  const comparable = normalizeComparableText(normalized);
  const hasBrand =
    /哔哩哔哩|bilibili|b23\.tv/i.test(normalized) ||
    BILIBILI_BRAND_TOKENS.some((token) => comparable.includes(token));
  const hasVideoIndicator =
    /UP主|播放[:：]|\bBV[0-9A-Za-z]{6,}\b|直播|番剧|投稿|av\d+|视频/i.test(normalized);

  return (
    /b23\.tv/i.test(normalized) ||
    /\bBV[0-9A-Za-z]{6,}\b/.test(normalized) ||
    (hasBrand && hasVideoIndicator) ||
    (hasBrand && comparable.length <= 20)
  );
}

function extractUrlsFromOcrText(linesOrText) {
  return extractOcrUrlEntries(linesOrText)
    .filter((entry) => entry.confidence === "confirmed")
    .map((entry) => entry.url);
}

function hasProtocolLikeHint(normalized) {
  return /https?(?::|;|\/)/.test(normalized) || normalized.startsWith("http") || normalized.startsWith("https");
}

function hasDomainLikeHint(normalized) {
  return /\b[a-z0-9-]+\.(?:com|cn|tv|net|org|io|cc|me|co|qq|top|vip|app|dev|live|site|link)\b/i.test(
    normalized
  );
}

function hasPathLikeHint(normalized) {
  return normalized.includes("/") || normalized.includes("?") || normalized.includes("&") || normalized.includes("=");
}

function extractUrlLikeSignature(text) {
  const normalized = normalizeUrlLikeText(text);
  if (!normalized) return "";
  if (
    hasProtocolLikeHint(normalized) ||
    (hasDomainLikeHint(normalized) && (hasPathLikeHint(normalized) || normalized.includes(".")))
  ) {
    return normalized;
  }
  return "";
}

function looksLikeUrlLikeText(text) {
  const normalized = extractUrlLikeSignature(text);
  if (!normalized) return false;
  if (/^https?:\/\//.test(normalized)) return true;
  if (/^www\./.test(normalized)) return true;
  if (extractUrlsFromText(normalized).length > 0) return true;
  if (hasProtocolLikeHint(normalized) && hasDomainLikeHint(normalized)) return true;
  return hasDomainLikeHint(normalized) && hasPathLikeHint(normalized);
}

function shouldFilterOcrFallbackBlock(block, clipboardBlocks) {
  if (!block) return true;

  const blockTitle = normalizeComparableText(block.shareCardTitle ?? "");
  const blockRawText = normalizeComparableText(block.rawText ?? "");
  const hasExactClipboardMatch = clipboardBlocks.some((candidate) => {
    const candidateTitle = normalizeComparableText(candidate.shareCardTitle ?? "");
    const candidateRawText = normalizeComparableText(candidate.rawText ?? "");
    return (
      (blockTitle && candidateTitle && blockTitle === candidateTitle) ||
      (blockRawText && candidateRawText && blockRawText === candidateRawText)
    );
  });
  if (hasExactClipboardMatch) return true;

  if (block.contentType === "image") {
    const imageRawText = normalizeComparableText(block.rawText ?? "");
    const hasContainedImageMatch = clipboardBlocks.some((candidate) => {
      if (candidate.contentType !== "image") return false;
      const candidateRawText = normalizeComparableText(candidate.rawText ?? "");
      if (Math.min(imageRawText.length, candidateRawText.length) < 24) return false;
      return imageRawText.includes(candidateRawText) || candidateRawText.includes(imageRawText);
    });
    if (hasContainedImageMatch) return true;
  }

  const directUrlEntries = getBlockDirectUrlEntries(block);
  if (directUrlEntries.length > 0) {
    const directBlockUrls = directUrlEntries.map((entry) => normalizeUrlLikeText(entry.url)).filter(Boolean);
    const directBlocks = clipboardBlocks.filter((candidate) => getBlockDirectUrlEntries(candidate).length > 0);

    return directBlocks.some((candidate) =>
      getBlockDirectUrlEntries(candidate)
        .map((entry) => normalizeUrlLikeText(entry.url))
        .filter(Boolean)
        .some((signature) =>
          directBlockUrls.some(
            (directUrl) => directUrl.includes(signature) || signature.includes(directUrl)
          )
        )
    );
  }

  const combinedText = [block.shareCardTitle, block.rawText].filter(Boolean).join(" ");
  if (looksLikeUrlLikeText(combinedText)) {
    return true;
  }

  const normalizedCombined = normalizeUrlLikeText(combinedText);
  if (!normalizedCombined) return false;

  const directBlocks = clipboardBlocks.filter((candidate) => getBlockDirectUrlEntries(candidate).length > 0);
  return directBlocks.some((candidate) => {
    const signatures = [
      candidate.rawText,
      candidate.shareCardTitle,
      ...getBlockDirectUrlEntries(candidate).map((entry) => entry.url),
    ]
      .filter(Boolean)
      .map(normalizeUrlLikeText)
      .filter(Boolean);

    return signatures.some(
      (signature) =>
        normalizedCombined.includes(signature) ||
        signature.includes(normalizedCombined)
    );
  });
}

function hasOcrUrlLikeLines(ocrLines) {
  return ocrLines.some((line) => looksLikeUrlLikeText(line?.text ?? ""));
}

function buildUrlLikeOcrSignature(ocrLines) {
  const signatures = [];
  const seen = new Set();

  for (const line of ocrLines) {
    const signature = extractUrlLikeSignature(line?.text ?? "");
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    signatures.push(signature);
    if (signatures.length >= 6) break;
  }

  return signatures.join("|");
}

function truncateComparableText(text, maxLength) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function normalizeArticleSignatureLine(text) {
  const value = String(text ?? "").normalize("NFKC").trim();
  if (!value) return "";
  if (looksLikeUrlLikeText(value) || looksLikeTimestampOcrText(value)) return "";

  const normalized = normalizeComparableText(value);
  if (!normalized) return "";

  if (/^(原创|链接|link)$/i.test(value)) return "";
  if (/^(哔哩哔哩|bilibili|b23\.tv)$/i.test(value)) return "";
  if (/^(UP主|播放[:：]?|直播|番剧|投稿|视频号)/i.test(value)) return "";

  return normalized;
}

function buildArticleFingerprintAliases(block) {
  const timestamp = normalizeComparableText(block?.timestampText ?? "");
  const title = normalizeArticleSignatureLine(block?.shareCardTitle ?? "");
  const rawLines = Array.isArray(block?.rawLines)
    ? block.rawLines
    : String(block?.rawText ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const signatureLines = rawLines.map(normalizeArticleSignatureLine).filter(Boolean);
  const primary = title || signatureLines[0] || normalizeComparableText(block?.rawText ?? "");
  const identity = [timestamp, primary].filter(Boolean).join("|");
  return identity ? [identity] : [];
}

function buildArticleFingerprint(block) {
  return buildArticleFingerprintAliases(block)[0] ?? "";
}

function buildBlockSignature(block) {
  const directUrls = getBlockDirectUrlEntries(block)
    .map((entry) => `${entry.confidence}:${canonicalizeUrl(entry.url)}`)
    .sort();
  if (directUrls.length > 0) {
    return `direct|${block?.timestampText ?? ""}|${directUrls.join("|")}`;
  }

  const articleFingerprint = buildArticleFingerprint(block);
  if (articleFingerprint) {
    return `share|${articleFingerprint}`;
  }

  return `raw|${normalizeComparableText(block?.rawText ?? "")}`;
}

function buildCandidateYBand(candidate) {
  const y = Number(candidate?.line?.y ?? candidate?.clickY ?? NaN);
  if (!Number.isFinite(y)) return null;
  return Math.max(0, Math.round(y / 120));
}

function findExistingArticleState(articleStates, articleFingerprints) {
  for (const fingerprint of articleFingerprints ?? []) {
    const state = articleStates.get(fingerprint);
    if (state) {
      return { fingerprint, state };
    }
  }
  return null;
}

function upsertArticleState(articleStates, articleFingerprints, updates) {
  const fingerprints = (articleFingerprints ?? []).filter(Boolean);
  if (fingerprints.length === 0) return null;

  const current =
    findExistingArticleState(articleStates, fingerprints)?.state ?? {
    status: "pending",
    attempted: false,
    resolved: false,
    failed: false,
    skipped: false,
    lastSeenPage: null,
    lastSeenYBand: null,
  };
  const next = { ...current, ...updates };
  for (const fingerprint of fingerprints) {
    articleStates.set(fingerprint, next);
  }
  return next;
}

function buildClusterRect(cluster) {
  const lines = Array.isArray(cluster) ? cluster.filter(Boolean) : [];
  if (lines.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const line of lines) {
    minX = Math.min(minX, line.x);
    minY = Math.min(minY, line.y);
    maxX = Math.max(maxX, line.x + line.width);
    maxY = Math.max(maxY, line.y + line.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function buildFallbackCandidateFromCluster(block, windowBounds, ocrResult) {
  const rect = buildClusterRect(block?.ocrCluster ?? []);
  if (!rect) return null;

  const clickPoint = mapOcrRectCenterToScreenPoint(windowBounds, rect, ocrResult);
  return {
    blockId: block.blockId,
    itemKey: block.blockId,
    title: block.shareCardTitle,
    timestampText: block.timestampText,
    rawText: block.rawText,
    ...(block.contentType ? { contentType: block.contentType } : {}),
    ...(block.classificationReason ? { classificationReason: block.classificationReason } : {}),
    ocrText: block.ocrCluster?.[0]?.text ?? block.shareCardTitle ?? "",
    lineIndex: null,
    clickX: clickPoint.x,
    clickY: clickPoint.y,
    line: { ...rect, text: block.ocrCluster?.[0]?.text ?? block.shareCardTitle ?? "" },
    matchReason: "cluster_fallback",
  };
}

function hasCandidateForActionableShareCards(blocks, candidateMap) {
  const actionableBlocks = blocks.filter(isActionableShareCardBlock);
  if (actionableBlocks.length === 0) return true;
  return actionableBlocks.some((block) => candidateMap.has(block.blockId));
}

function isActionableShareCardBlock(block) {
  return Boolean(block?.shareCardTitle) &&
    getBlockDirectUrlEntries(block).length === 0 &&
    (!block.skipReason || block.skipReason === "video_channel");
}

export function buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds }) {
  const ocrLines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const titleLine = findFileHelperTitleLine(ocrLines, ocrResult?.height ?? windowBounds?.height ?? 0);
  const blocks = normalizeSnapshotBlocks(clipboardSnapshot);
  const ocrFallbackBlocks = inferShareCardItemsFromOcr(ocrLines, {
        imageWidth: ocrResult?.width ?? windowBounds?.width ?? 0,
        imageHeight: ocrResult?.height ?? windowBounds?.height ?? 0,
      })
        .map(ocrFallbackItemToBlock)
        .filter((block) => !shouldFilterOcrFallbackBlock(block, blocks));
  const effectiveBlocks = [...blocks, ...ocrFallbackBlocks];
  const effectiveItems = effectiveBlocks.map(blockToSnapshotItem).filter(Boolean);
  const shareCardBlocks = effectiveBlocks.filter(isActionableShareCardBlock);
  const candidates = [];
  const usedLineIndexes = new Set();
  let lastMatchedY = -1;

  for (const block of shareCardBlocks) {
    if (Array.isArray(block.ocrCluster) && block.ocrCluster.length > 0) {
      const clusterCandidate = buildFallbackCandidateFromCluster(block, windowBounds, ocrResult);
      if (clusterCandidate) {
        candidates.push(clusterCandidate);
      }
      continue;
    }

    const match = findBestShareCardLine({
      item: {
        title: block.shareCardTitle,
        rawText: block.rawText,
      },
      ocrLines,
      usedLineIndexes,
      lastMatchedY,
      imageHeight: ocrResult?.height ?? windowBounds?.height ?? 0,
    });
    if (!match) {
      const fallbackCandidate = buildFallbackCandidateFromCluster(block, windowBounds, ocrResult);
      if (fallbackCandidate) {
        candidates.push(fallbackCandidate);
      }
      continue;
    }

    usedLineIndexes.add(match.lineIndex);
    lastMatchedY = match.line.y;
    const clickPoint = mapOcrRectCenterToScreenPoint(windowBounds, match.line, ocrResult);

    candidates.push({
      blockId: block.blockId,
      itemKey: block.blockId,
      title: block.shareCardTitle,
      timestampText: block.timestampText,
      rawText: block.rawText,
      ...(block.contentType ? { contentType: block.contentType } : {}),
      ...(block.classificationReason ? { classificationReason: block.classificationReason } : {}),
      ocrText: match.line.text,
      lineIndex: match.lineIndex,
      clickX: clickPoint.x,
      clickY: clickPoint.y,
      line: match.line,
    });
  }

  return {
    titleLine,
    titleMatched: Boolean(titleLine),
    ocrLines,
    candidates,
    effectiveBlocks,
    effectiveItems,
    ocrFallbackBlocks,
  };
}

function findBestShareCardLine({ item, ocrLines, usedLineIndexes, lastMatchedY, imageHeight }) {
  const titleNorm = normalizeComparableText(item.title || item.rawText);
  const topBoundary = imageHeight > 0 ? imageHeight * 0.16 : 0;
  const bottomBoundary = imageHeight > 0 ? imageHeight * 0.95 : Number.POSITIVE_INFINITY;

  let best = null;
  for (let index = 0; index < ocrLines.length; index++) {
    if (usedLineIndexes.has(index)) continue;
    const line = ocrLines[index];
    if (!line?.text) continue;
    if (line.y < topBoundary || line.y > bottomBoundary) continue;

    const normalized = normalizeComparableText(line.text);
    let score = 0;

    if (titleNorm && normalized) {
      if (normalized.includes(titleNorm)) score += 20;
      else if (titleNorm.includes(normalized) && normalized.length >= 4) score += 14;
    }

    if (normalized.includes("链接") || normalized.includes("link")) score += 6;
    if (line.y >= lastMatchedY - 8) score += 3;
    else score -= 8;
    if (line.width >= 80) score += 1;

    if (score < 6) continue;
    if (!best || score > best.score || (score === best.score && line.y < best.line.y)) {
      best = { lineIndex: index, line, score };
    }
  }

  return best;
}

export async function probeUiEnvironment(
  {
    requireChatReady = true,
    debug = false,
    artifactDir = null,
    label = "probe",
    returnCapturedPage = false,
  } = {},
  {
    getFrontWeChatWindowFn = getWeChatChatWindow,
    isWeChatRunningFn = isWeChatRunning,
    captureWindowScreenshotFn = captureWindowScreenshot,
    readVisibleClipboardSnapshotFn = readVisibleClipboardSnapshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    probeVisionAvailabilityFn = probeVisionAvailability,
  } = {}
) {
  const probe = {
    ui_probe_status: "ready",
    vision_available: false,
    wechat_running: false,
    current_chat_ready: false,
    message_ocr_found: false,
    reasons: [],
    title_line_text: null,
    ocr_line_count: 0,
  };

  if (artifactDir != null) {
    await fs.mkdir(artifactDir, { recursive: true });
  }

  probe.wechat_running = isWeChatRunningFn();
  if (!probe.wechat_running) {
    probe.ui_probe_status = "wechat_not_running";
    probe.reasons.push("WeChat is not running.");
    return probe;
  }

  probe.vision_available = await probeVisionAvailabilityFn();
  if (!probe.vision_available) {
    probe.ui_probe_status = "vision_unavailable";
    probe.reasons.push("Swift Vision OCR is unavailable on this machine.");
    return probe;
  }

  const window = getFrontWeChatWindowFn();
  if (!window) {
    probe.ui_probe_status = "window_unavailable";
    probe.reasons.push("No visible WeChat window is available.");
    return probe;
  }

  const screenshotPath =
    artifactDir != null
      ? path.join(artifactDir, `${label}.png`)
      : path.join(os.tmpdir(), `wechat-filehelper-${Date.now()}-${label}.png`);

  let clipboardSnapshot = null;
  let ocrResult;
  let samplingMode = "ocr_only";
  try {
    captureWindowScreenshotFn(window, screenshotPath);
    ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const inferredShareCards = inferShareCardItemsFromOcr(ocrResult?.lines ?? [], {
      imageWidth: ocrResult?.width ?? window?.width ?? 0,
      imageHeight: ocrResult?.height ?? window?.height ?? 0,
    });
    const needsClipboardSnapshot =
      hasOcrUrlLikeLines(ocrResult?.lines ?? []) || inferredShareCards.length === 0;
    if (needsClipboardSnapshot) {
      clipboardSnapshot = readVisibleClipboardSnapshotFn(debug);
      samplingMode = "ocr_plus_clipboard";
    } else {
      clipboardSnapshot = emptyClipboardSnapshot();
    }
  } catch (err) {
    probe.ui_probe_status = "screen_capture_failed";
    probe.reasons.push(`UI screenshot/OCR failed: ${err.message}`);
    return probe;
  } finally {
    if (artifactDir == null) {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }
  }

  const snapshot = buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds: window });
  probe.title_line_text = snapshot.titleLine?.text ?? null;
  probe.current_chat_ready = snapshot.titleMatched;
  probe.ocr_line_count = snapshot.ocrLines.length;
  probe.message_ocr_found =
    snapshot.ocrLines.filter((line) => line.y > (ocrResult.height || window.height) * 0.16).length > 0;

  if (returnCapturedPage) {
    probe.captured_page = {
      window,
      clipboardSnapshot,
      ocrResult,
      screenshotPath,
      samplingMode,
      urlLikeSignature: buildUrlLikeOcrSignature(ocrResult?.lines ?? []),
    };
  }

  if (!snapshot.titleMatched && requireChatReady) {
    probe.ui_probe_status = "chat_not_ready";
    probe.reasons.push("Current WeChat title bar OCR does not match 文件传输助手.");
  }

  if (!probe.message_ocr_found) {
    probe.ui_probe_status = "ocr_empty";
    probe.reasons.push("OCR did not find visible chat messages in the WeChat window.");
  }

  return probe;
}

export function formatUiProbeReport(probe) {
  const lines = [
    "WeChat macOS UI probe",
    "=".repeat(50),
    `Probe status      : ${probe.ui_probe_status}`,
    `WeChat running    : ${probe.wechat_running ? "yes" : "no"}`,
    `Vision available  : ${probe.vision_available ? "yes" : "no"}`,
    `Chat ready        : ${probe.current_chat_ready ? "yes" : "no"}`,
    `OCR lines         : ${probe.ocr_line_count ?? 0}`,
    `Title OCR         : ${probe.title_line_text ?? "(not found)"}`,
  ];

  if (probe.reasons?.length) {
    lines.push("");
    lines.push("Reasons:");
    for (const reason of probe.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  return lines.join("\n");
}

export async function scanUiLinks(
  since,
  until,
  maxScrolls,
  debug = false,
  {
    runDir = null,
    maxCandidates = Number.POSITIVE_INFINITY,
    waitForUserReadyFn = waitForUserReady,
    navigateToFileHelperFn = navigateToFileHelper,
    readVisibleClipboardSnapshotFn = readVisibleClipboardSnapshot,
    scrollPageFn = scrollUpOnce,
    captureVisibleUiPageFn = captureVisibleUiPage,
    probeUiEnvironmentFn = probeUiEnvironment,
    extractShareCardUrlFn = extractShareCardUrl,
    extractImageContentFn = extractImageContent,
    publishImageContentRecordFn = publishImageContentRecord,
    nowFn = () => new Date(),
  } = {}
) {
  const sessionId = newCaptureSessionId();
  let capturedAt;
  let referenceNow;
  let fallbackMessageTime;
  const stats = {
    source: "ui",
    share_cards_seen: 0,
    share_cards_attempted: 0,
    share_cards_resolved: 0,
    share_cards_unresolved: 0,
    unresolved_items_total: 0,
    image_items_seen: 0,
    image_items_processed: 0,
    image_items_needs_review: 0,
    image_candidates_rerouted_to_article: 0,
    uncertain_links_total: 0,
    browser_fallback_used: 0,
    clipboard_reads: 0,
    ocr_only_pages: 0,
    duplicate_skipped: 0,
    skipped_by_rule: {},
    viewer_open_wait_ms_total: 0,
    viewer_ready_wait_ms_total: 0,
    viewer_menu_wait_ms_total: 0,
    viewer_copy_wait_ms_total: 0,
    viewer_close_wait_ms_total: 0,
    image_ocr_wait_ms_total: 0,
    pages_scanned: 0,
    scrolls_performed: 0,
    termination_reason: null,
    range_coverage: "unverified",
    oldest_visible_message_time: null,
  };

  const records = [];
  const uncertainRecords = [];
  const skippedRecords = [];
  const unresolvedRecords = [];
  const contentRecords = [];
  const seenUrls = new Set();
  const seenUncertainUrls = new Set();
  const seenKeys = new Set();
  const seenSkippedKeys = new Set();
  const seenUnresolvedKeys = new Set();
  const articleStates = new Map();
  const typeOutcomeLedger = new Map();
  const seenPages = new Set();
  const artifactDir = runDir ? path.join(runDir, "artifacts") : null;
  const candidateArtifacts = [];

  function observeTypeOutcome(contentType, identity) {
    const key = `${contentType}|${identity}`;
    const existing = typeOutcomeLedger.get(key);
    if (existing) return { key, isNew: false };
    typeOutcomeLedger.set(key, { contentType, outcome: null });
    return { key, isNew: true };
  }

  function finalizeTypeOutcome(observation, outcome) {
    if (!observation?.key) return;
    const entry = typeOutcomeLedger.get(observation.key);
    if (!entry || entry.outcome != null) return;
    entry.outcome = outcome;
  }

  function reclassifyTypeOutcome(observation, contentType) {
    if (!observation?.key) return;
    const entry = typeOutcomeLedger.get(observation.key);
    if (entry) entry.contentType = contentType;
  }

  function accumulateExtractionTimings(extraction) {
    stats.viewer_open_wait_ms_total += extraction.timings?.viewer_open_wait_ms ?? 0;
    stats.viewer_ready_wait_ms_total += extraction.timings?.viewer_ready_wait_ms ?? 0;
    stats.viewer_menu_wait_ms_total += extraction.timings?.viewer_menu_wait_ms ?? 0;
    stats.viewer_copy_wait_ms_total += extraction.timings?.viewer_copy_wait_ms ?? 0;
    stats.viewer_close_wait_ms_total += extraction.timings?.viewer_close_wait_ms ?? 0;
    stats.image_ocr_wait_ms_total += extraction.timings?.image_ocr_wait_ms ?? 0;
  }

  function summarizeTypeOutcomes() {
    const summary = {};
    for (const entry of typeOutcomeLedger.values()) {
      if (!summary[entry.contentType]) {
        summary[entry.contentType] = {
          seen: 0,
          recorded: 0,
          needs_review: 0,
          uncertain: 0,
          skipped: 0,
          unresolved: 0,
          deduplicated: 0,
        };
      }
      summary[entry.contentType].seen += 1;
      if (entry.outcome != null) {
        summary[entry.contentType][entry.outcome] += 1;
      }
    }
    return summary;
  }

  function blockOutcomeType(block) {
    if (block.contentType === "image") return "image";
    if (block.skipReason === "video_channel") return "video_channel";
    if (block.skipReason) return "unsupported";
    return "article";
  }

  function getMessageTimeSource(messageTime) {
    return messageTime ? "visible_timestamp" : "range_until_fallback";
  }

  function pushSkippedRecord({ messageTime, title = "", rawText = "", skipReason, rawUrl = "" }) {
    if (!skipReason) return;

    const messageTimeIso = (messageTime ?? fallbackMessageTime).toISOString();
    const dedupeBasis = rawUrl || title || truncateComparableText(rawText, 40) || skipReason;
    const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, `skip:${skipReason}:${dedupeBasis}`);
    if (seenSkippedKeys.has(key)) return;
    seenSkippedKeys.add(key);

    skippedRecords.push({
      captured_at: capturedAt.toISOString(),
      message_time: messageTimeIso,
      message_time_source: getMessageTimeSource(messageTime),
      chat_name: FILE_HELPER_CHAT_NAME,
      record_type: "skipped_card",
      title: title || rawUrl || "(untitled skipped card)",
      raw_text: rawText || rawUrl || "",
      skip_reason: skipReason,
      dedupe_key: key,
      capture_session_id: sessionId,
      source: "ui",
    });
  }

  function pushUnresolvedRecord({
    messageTime,
    block,
    candidate = null,
    failureStage,
    errorCode,
    attemptCount,
    pageIndex,
  }) {
    const messageTimeIso = (messageTime ?? fallbackMessageTime).toISOString();
    const contentType =
      block.contentType === "image"
        ? "image"
        : block.skipReason === "video_channel"
          ? "video_channel"
          : "article";
    const identity =
      normalizeComparableText(block.shareCardTitle) ||
      normalizeComparableText(truncateComparableText(block.rawText, 80)) ||
      block.blockId;
    const key = dedupeKey(
      FILE_HELPER_CHAT_NAME,
      messageTimeIso,
      `unresolved:${contentType}:${identity}`
    );
    if (seenUnresolvedKeys.has(key)) return;
    seenUnresolvedKeys.add(key);

    unresolvedRecords.push({
      captured_at: capturedAt.toISOString(),
      message_time: messageTimeIso,
      message_time_source: getMessageTimeSource(messageTime),
      chat_name: FILE_HELPER_CHAT_NAME,
      record_type: "unresolved_item",
      content_type: contentType,
      message_type: contentType === "image" ? "image" : "share_card",
      title: block.shareCardTitle ?? candidate?.title ?? "",
      raw_text: block.rawText ?? "",
      failure_stage: failureStage,
      error_code: errorCode || "unknown_failure",
      attempt_count: attemptCount,
      page_index: pageIndex,
      click_x: candidate?.clickX ?? null,
      click_y: candidate?.clickY ?? null,
      dedupe_key: key,
      capture_session_id: sessionId,
      source: "ui",
    });
    stats.unresolved_items_total += 1;
  }

  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
  }

  await waitForUserReadyFn();
  await navigateToFileHelperFn(debug);
  capturedAt = nowFn();
  referenceNow = capturedAt;
  fallbackMessageTime = until instanceof Date ? until : capturedAt;

  const uiProbe = await probeUiEnvironmentFn(
    { requireChatReady: true, debug, artifactDir, label: "ui-probe", returnCapturedPage: true },
    { readVisibleClipboardSnapshotFn }
  );
  if (uiProbe.ui_probe_status !== "ready") {
    throw new Error(`UI scan is not ready: ${uiProbe.reasons.join(" ")}`);
  }

  let scrollCount = 0;
  let consecutiveDuplicatePages = 0;
  let limitReached = false;
  let lastUrlLikeSignature = uiProbe.captured_page?.urlLikeSignature ?? null;
  let terminationReason = null;
  let oldestVisibleMessageTime = null;

  while (scrollCount <= maxScrolls && !limitReached) {
    let page = await captureVisibleUiPageFn({
      pageIndex: scrollCount,
      debug,
      artifactDir,
      readVisibleClipboardSnapshotFn,
      prefetchedWindow: scrollCount === 0 ? uiProbe.captured_page?.window ?? null : null,
      prefetchedClipboardSnapshot:
        scrollCount === 0 ? uiProbe.captured_page?.clipboardSnapshot ?? null : null,
      prefetchedOcrResult: scrollCount === 0 ? uiProbe.captured_page?.ocrResult ?? null : null,
      prefetchedScreenshotPath:
        scrollCount === 0 ? uiProbe.captured_page?.screenshotPath ?? null : null,
      prefetchedSamplingMode: scrollCount === 0 ? uiProbe.captured_page?.samplingMode ?? null : null,
      previousUrlLikeSignature:
        scrollCount === 0 ? null : lastUrlLikeSignature,
    });

    const shouldForceClipboardResample =
      !hasCandidateForActionableShareCards(normalizeSnapshotBlocks(page.clipboardSnapshot), page.candidateMap) &&
      !String(page.clipboardSnapshot?.rawText ?? "").trim() &&
      page.samplingMode !== "ocr_plus_clipboard";
    if (shouldForceClipboardResample) {
      if (debug) {
        console.log("[debug] OCR-only page has actionable blocks but no candidates; forcing clipboard resample...");
      }
      page = await captureVisibleUiPageFn({
        pageIndex: scrollCount,
        debug,
        artifactDir,
        readVisibleClipboardSnapshotFn,
        forceClipboardSnapshot: true,
        previousUrlLikeSignature: null,
      });
    }
    stats.pages_scanned += 1;

    const pageBlocks = normalizeSnapshotBlocks(page.clipboardSnapshot);
    if (page.samplingMode === "ocr_plus_clipboard") {
      stats.clipboard_reads += 1;
    } else if (page.samplingMode === "ocr_only") {
      stats.ocr_only_pages += 1;
    }

    const pageSignature = pageBlocks.map((block) => buildBlockSignature(block)).join(";");
    if (seenPages.has(pageSignature)) {
      consecutiveDuplicatePages += 1;
      if (consecutiveDuplicatePages >= 2) {
        terminationReason = "duplicate_pages";
        break;
      }
    } else {
      seenPages.add(pageSignature);
      consecutiveDuplicatePages = 0;
    }
    lastUrlLikeSignature = page.urlLikeSignature ?? null;
    const pageHasCandidateGenerationFailure = !hasCandidateForActionableShareCards(pageBlocks, page.candidateMap);

    stats.share_cards_seen += pageBlocks.filter((block) => Boolean(block.shareCardTitle)).length;
    for (const [reason, count] of Object.entries(page.clipboardSnapshot.stats.skipped_by_rule)) {
      if (reason === "video_channel") continue;
      incrementCount(stats.skipped_by_rule, reason, count);
    }

    let reachedBeforeRange = false;
    for (const block of pageBlocks) {
      let messageTime = null;
      if (block.timestampText) {
        messageTime = parseWeChatTimestamp(block.timestampText, referenceNow);
      }
      if (messageTime && (!oldestVisibleMessageTime || messageTime < oldestVisibleMessageTime)) {
        oldestVisibleMessageTime = messageTime;
      }

      if (messageTime) {
        if (messageTime < since) {
          reachedBeforeRange = true;
          continue;
        }
        if (messageTime > until) continue;
      }

      const articleFingerprints = buildArticleFingerprintAliases(block);
      const articleFingerprint = articleFingerprints[0] ?? "";
      const existingArticleState = findExistingArticleState(articleStates, articleFingerprints)?.state ?? null;

      const directUrlEntries = getBlockDirectUrlEntries(block);
      const messageTimeIso = (messageTime ?? fallbackMessageTime).toISOString();
      const blockOutcomeObservation =
        directUrlEntries.length === 0 && block.shareCardTitle
          ? observeTypeOutcome(
              blockOutcomeType(block),
              `${messageTimeIso}|${articleFingerprint || normalizeComparableText(block.rawText) || block.blockId}`,
            )
          : null;
      if (block.contentType === "image" && blockOutcomeObservation?.isNew) {
        stats.image_items_seen += 1;
      }
      const directOutcomeObservations = new Map();
      const directOutcomeObservation = (confidence, canonicalUrl) => {
        const directKey = `${confidence}:${canonicalUrl}`;
        if (!directOutcomeObservations.has(directKey)) {
          directOutcomeObservations.set(
            directKey,
            observeTypeOutcome("direct_url", `${messageTimeIso}|${directKey}`),
          );
        }
        return directOutcomeObservations.get(directKey);
      };
      const directRecords = [];
      const uncertainDirectRecords = [];
      const directSkippedEntries = [];
      const directSeen = new Set();
      for (const entry of directUrlEntries) {
        const canonicalUrl = canonicalizeUrl(entry.url);
        const skipReason = classifySkipReason(canonicalUrl);
        if (skipReason) {
          directSkippedEntries.push({
            url: canonicalUrl,
            reason: skipReason,
            confidence: entry.confidence,
            confidenceReason: entry.confidenceReason ?? null,
          });
          incrementCount(stats.skipped_by_rule, skipReason);
          continue;
        }
        const directKey = `${entry.confidence}:${canonicalUrl}`;
        if (directSeen.has(directKey)) continue;
        directSeen.add(directKey);
        if (entry.confidence === "uncertain") {
          uncertainDirectRecords.push({
            url: canonicalUrl,
            confidenceReason: entry.confidenceReason ?? "ocr_ambiguous",
          });
        } else {
          directRecords.push(canonicalUrl);
        }
      }

      const artifactRecord =
        block.shareCardTitle != null
          ? {
              item_key: block.blockId,
              title: block.shareCardTitle,
              timestamp_text: block.timestampText,
              raw_text: block.rawText,
              page_index: scrollCount,
              click_x: null,
              click_y: null,
              status: "pending",
              content_type: block.contentType ?? (block.skipReason === "video_channel" ? "video_channel" : "article"),
              classification_reason: block.classificationReason ?? null,
              article_fingerprint: articleFingerprint || null,
              sampling_mode: page.samplingMode ?? null,
            }
          : null;

      if (directRecords.length > 0 || uncertainDirectRecords.length > 0) {
        for (const skippedEntry of directSkippedEntries) {
          finalizeTypeOutcome(
            directOutcomeObservation(skippedEntry.confidence, skippedEntry.url),
            "skipped",
          );
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? skippedEntry.url,
            rawText: block.rawText,
            skipReason: skippedEntry.reason,
            rawUrl: skippedEntry.url,
          });
        }

        for (const canonicalUrl of directRecords) {
          const outcomeObservation = directOutcomeObservation("confirmed", canonicalUrl);
          if (seenUrls.has(canonicalUrl)) {
            finalizeTypeOutcome(outcomeObservation, "deduplicated");
            continue;
          }
          seenUrls.add(canonicalUrl);

          const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
          if (seenKeys.has(key)) {
            finalizeTypeOutcome(outcomeObservation, "deduplicated");
            continue;
          }
          seenKeys.add(key);

          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            message_time_source: getMessageTimeSource(messageTime),
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "link",
            message_type: block.shareCardTitle ? "share_card" : "text_url",
            title: block.shareCardTitle ?? "",
            url: canonicalUrl,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
          finalizeTypeOutcome(outcomeObservation, "recorded");
        }

        for (const uncertainEntry of uncertainDirectRecords) {
          const outcomeObservation = directOutcomeObservation("uncertain", uncertainEntry.url);
          if (seenUrls.has(uncertainEntry.url) || seenUncertainUrls.has(uncertainEntry.url)) {
            finalizeTypeOutcome(outcomeObservation, "deduplicated");
            continue;
          }
          seenUncertainUrls.add(uncertainEntry.url);

          const key = dedupeKey(
            FILE_HELPER_CHAT_NAME,
            messageTimeIso,
            `uncertain:${uncertainEntry.url}:${uncertainEntry.confidenceReason}`
          );
          if (seenKeys.has(key)) {
            finalizeTypeOutcome(outcomeObservation, "deduplicated");
            continue;
          }
          seenKeys.add(key);

          uncertainRecords.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            message_time_source: getMessageTimeSource(messageTime),
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "uncertain_link",
            message_type: block.shareCardTitle ? "share_card" : "text_url",
            title: block.shareCardTitle ?? "",
            url: uncertainEntry.url,
            confidence_reason: uncertainEntry.confidenceReason,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
          finalizeTypeOutcome(outcomeObservation, "uncertain");
        }

        if (artifactRecord) {
          artifactRecord.status = directRecords.length > 0 ? "resolved_direct_url" : "uncertain_direct_url";
          artifactRecord.url = directRecords[0] ?? uncertainDirectRecords[0]?.url ?? null;
          artifactRecord.reason = uncertainDirectRecords[0]?.confidenceReason ?? null;
          candidateArtifacts.push(artifactRecord);
        }
        stats.uncertain_links_total += uncertainDirectRecords.length;
        upsertArticleState(articleStates, articleFingerprints, {
          status: "resolved",
          attempted: true,
          resolved: true,
          failed: false,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: null,
        });
        continue;
      }

      if (directUrlEntries.length > 0) {
        if (artifactRecord) {
          artifactRecord.status = "skipped";
          artifactRecord.reason = directSkippedEntries[0]?.reason ?? "direct_url_skipped";
          candidateArtifacts.push(artifactRecord);
        }
        for (const skippedEntry of directSkippedEntries) {
          finalizeTypeOutcome(
            directOutcomeObservation(skippedEntry.confidence, skippedEntry.url),
            "skipped",
          );
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? skippedEntry.url,
            rawText: block.rawText,
            skipReason: skippedEntry.reason,
            rawUrl: skippedEntry.url,
          });
        }
        upsertArticleState(articleStates, articleFingerprints, {
          status: "skipped",
          attempted: true,
          resolved: false,
          failed: false,
          skipped: true,
          lastSeenPage: scrollCount,
          lastSeenYBand: null,
        });
        continue;
      }

      if (!isActionableShareCardBlock(block)) {
        if (artifactRecord && block.skipReason) {
          if (existingArticleState) {
            finalizeTypeOutcome(blockOutcomeObservation, "skipped");
            artifactRecord.status = "duplicate_skipped";
            artifactRecord.reason = "article_already_skipped";
            stats.duplicate_skipped += 1;
            candidateArtifacts.push(artifactRecord);
            upsertArticleState(articleStates, articleFingerprints, {
              lastSeenPage: scrollCount,
              lastSeenYBand: existingArticleState.lastSeenYBand ?? null,
            });
            continue;
          }
          artifactRecord.status = "skipped";
          artifactRecord.reason = block.skipReason;
          candidateArtifacts.push(artifactRecord);
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? "",
            rawText: block.rawText,
            skipReason: block.skipReason,
          });
          finalizeTypeOutcome(blockOutcomeObservation, "skipped");
          upsertArticleState(articleStates, articleFingerprints, {
            status: "skipped",
            attempted: true,
            resolved: false,
            failed: false,
            skipped: true,
            lastSeenPage: scrollCount,
            lastSeenYBand: null,
          });
        }
        continue;
      }

      if (existingArticleState) {
        if (artifactRecord) {
          artifactRecord.status = "duplicate_skipped";
          artifactRecord.reason =
            existingArticleState.status === "resolved"
              ? "article_already_resolved"
              : existingArticleState.status === "skipped"
                ? "article_already_skipped"
              : "article_already_attempted";
          candidateArtifacts.push(artifactRecord);
        }
        stats.duplicate_skipped += 1;
        finalizeTypeOutcome(blockOutcomeObservation, "deduplicated");
        upsertArticleState(articleStates, articleFingerprints, {
          lastSeenPage: scrollCount,
          lastSeenYBand: existingArticleState.lastSeenYBand ?? null,
        });
        continue;
      }

      const candidate = page.candidateMap.get(block.blockId);
      if (artifactRecord) {
        artifactRecord.click_x = candidate?.clickX ?? null;
        artifactRecord.click_y = candidate?.clickY ?? null;
        candidateArtifacts.push(artifactRecord);
      }

      if (!candidate) {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = pageHasCandidateGenerationFailure
          ? "candidate_generation_failed"
          : "ocr_candidate_missing";
        stats.share_cards_unresolved += 1;
        finalizeTypeOutcome(blockOutcomeObservation, "unresolved");
        pushUnresolvedRecord({
          messageTime,
          block,
          failureStage: "candidate_detection",
          errorCode: artifactRecord.reason,
          attemptCount: 0,
          pageIndex: scrollCount,
        });
        continue;
      }

      const candidateYBand = buildCandidateYBand(candidate);
      upsertArticleState(articleStates, articleFingerprints, {
        status: "attempted",
        attempted: true,
        resolved: false,
        failed: false,
        skipped: false,
        lastSeenPage: scrollCount,
        lastSeenYBand: candidateYBand,
      });

      stats.share_cards_attempted += 1;
      if (debug) {
        console.log(
          `[debug] Trying share card: ${candidate.title ?? block.shareCardTitle ?? "(untitled)"} @ ${candidate.clickX},${candidate.clickY}`
        );
      }
      let extraction =
        block.contentType === "image"
          ? await extractImageContentFn(
              candidate,
              {
                debug,
                artifactDir,
                capturedAt,
                messageTime: messageTime ?? fallbackMessageTime,
                messageTimeSource: getMessageTimeSource(messageTime),
                captureSessionId: sessionId,
                chatName: FILE_HELPER_CHAT_NAME,
              },
              { recoverChatFn: navigateToFileHelperFn },
            )
          : await extractShareCardUrlFn(candidate, {
              debug,
              artifactDir,
            }, {
              recoverChatFn: navigateToFileHelperFn,
            });

      let extractionTimingsAccumulated = false;
      if (
        block.contentType === "image" &&
        extraction.status === "type_hint" &&
        extraction.actualContentType === "article"
      ) {
        accumulateExtractionTimings(extraction);
        const hintedImageExtraction = extraction;
        const articleExtraction = await extractShareCardUrlFn(candidate, {
          debug,
          artifactDir,
        }, {
          recoverChatFn: navigateToFileHelperFn,
        });
        accumulateExtractionTimings(articleExtraction);
        extractionTimingsAccumulated = true;
        const articleUrlConfirmed = isSupportedArticleViewerUrl(articleExtraction.url);
        const articleRecoveryFailed = isViewerRecoveryFailure(articleExtraction);

        if (articleUrlConfirmed) {
          stats.image_items_seen = Math.max(0, stats.image_items_seen - 1);
          stats.image_candidates_rerouted_to_article += 1;
          reclassifyTypeOutcome(blockOutcomeObservation, "article");
          block.contentType = null;
          block.classificationReason = "viewer_type_reroute";
          artifactRecord.content_type = "article";
          artifactRecord.classification_reason = "viewer_type_reroute";
          extraction = articleExtraction;
        } else if (articleRecoveryFailed) {
          extraction = {
            ...articleExtraction,
            failureStage: "viewer_recovery",
          };
        } else if (hintedImageExtraction.record) {
          try {
            const published = await publishImageContentRecordFn(hintedImageExtraction.record);
            extraction = {
              ...hintedImageExtraction,
              status: "ok",
              reason: null,
              failureStage: null,
              actualContentType: undefined,
              record:
                published.pkm_status === "needs_review" && hintedImageExtraction.artifactPath
                  ? { ...published, review_artifact_path: hintedImageExtraction.artifactPath }
                  : published,
            };
          } catch (error) {
            extraction = {
              ...hintedImageExtraction,
              status: "failed",
              reason: error?.code || "image_note_write_failed",
              failureStage: "pkm_write",
              actualContentType: undefined,
              record: {
                ...hintedImageExtraction.record,
                pkm_status: "write_failed",
                ...(hintedImageExtraction.artifactPath
                  ? { artifact_path: hintedImageExtraction.artifactPath }
                  : {}),
              },
            };
          }
        } else {
          extraction = {
            ...hintedImageExtraction,
            status: "failed",
            reason: "viewer_type_unconfirmed",
            failureStage: "viewer_type",
            actualContentType: undefined,
          };
        }
      }

      if (!extractionTimingsAccumulated) {
        accumulateExtractionTimings(extraction);
      }

      if (block.contentType === "image") {
        const viewerRecoveryFailed = isViewerRecoveryFailure(extraction);
        if (extraction.record) {
          extraction.record = {
            ...extraction.record,
            message_time_source: getMessageTimeSource(messageTime),
          };
        }
        if (extraction.record && !seenKeys.has(extraction.record.dedupe_key)) {
          seenKeys.add(extraction.record.dedupe_key);
          contentRecords.push(extraction.record);
        }

        if (extraction.status === "ok" && extraction.record) {
          artifactRecord.status = "resolved";
          artifactRecord.content_hash = extraction.record.content_hash;
          artifactRecord.note_path = extraction.record.note_path ?? null;
          artifactRecord.pkm_status = extraction.record.pkm_status;
          stats.share_cards_resolved += 1;
          stats.image_items_processed += 1;
          if (extraction.record.pkm_status === "needs_review") {
            stats.image_items_needs_review += 1;
            finalizeTypeOutcome(blockOutcomeObservation, "needs_review");
          } else {
            finalizeTypeOutcome(blockOutcomeObservation, "recorded");
          }
          upsertArticleState(articleStates, articleFingerprints, {
            status: "resolved",
            attempted: true,
            resolved: true,
            failed: false,
            skipped: false,
            lastSeenPage: scrollCount,
            lastSeenYBand: candidateYBand,
          });
        } else {
          artifactRecord.status = "unresolved";
          artifactRecord.reason = extraction.reason ?? "image_extraction_failed";
          stats.share_cards_unresolved += 1;
          finalizeTypeOutcome(blockOutcomeObservation, "unresolved");
          pushUnresolvedRecord({
            messageTime,
            block,
            candidate,
            failureStage: extraction.failureStage ?? "image_ocr",
            errorCode: artifactRecord.reason,
            attemptCount: 1,
            pageIndex: scrollCount,
          });
          upsertArticleState(articleStates, articleFingerprints, {
            status: "failed",
            attempted: true,
            resolved: false,
            failed: true,
            skipped: false,
            lastSeenPage: scrollCount,
            lastSeenYBand: candidateYBand,
          });
        }

        if (viewerRecoveryFailed) {
          limitReached = true;
          if (debug) {
            console.log("[debug] Viewer recovery failed; stopping UI scan to avoid acting on an unknown window.");
          }
          break;
        }

        if (stats.share_cards_attempted >= maxCandidates) {
          limitReached = true;
          if (debug) {
            console.log(`[debug] Reached max candidate limit (${maxCandidates}), stopping early.`);
          }
          break;
        }
        continue;
      }

      const viewerRecoveryFailed = isViewerRecoveryFailure(extraction);
      if ((extraction.status === "ok" || viewerRecoveryFailed) && extraction.url) {
        const canonicalUrl = canonicalizeUrl(extraction.url);
        const skipReason = classifySkipReason(canonicalUrl);
        if (skipReason) {
          incrementCount(stats.skipped_by_rule, skipReason);
          artifactRecord.status = "skipped";
          artifactRecord.reason = skipReason;
          pushSkippedRecord({
            messageTime,
            title: candidate.title ?? block.shareCardTitle ?? "",
            rawText: block.rawText,
            skipReason,
            rawUrl: canonicalUrl,
          });
          finalizeTypeOutcome(blockOutcomeObservation, "skipped");
          upsertArticleState(articleStates, articleFingerprints, {
            status: "skipped",
            attempted: true,
            resolved: false,
            failed: false,
            skipped: true,
            lastSeenPage: scrollCount,
            lastSeenYBand: candidateYBand,
          });
          continue;
        }

        const messageTimeIso = (messageTime ?? fallbackMessageTime).toISOString();
        const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          seenUrls.add(canonicalUrl);
          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            message_time_source: getMessageTimeSource(messageTime),
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "link",
            message_type: "share_card",
            title: candidate.title ?? block.shareCardTitle ?? "",
            url: canonicalUrl,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
          finalizeTypeOutcome(blockOutcomeObservation, "recorded");
        } else {
          finalizeTypeOutcome(blockOutcomeObservation, "deduplicated");
        }

        artifactRecord.status = viewerRecoveryFailed
          ? "resolved_with_recovery_failure"
          : "resolved";
        artifactRecord.url = canonicalUrl;
        artifactRecord.used_browser_fallback = Boolean(extraction.usedBrowserFallback);
        artifactRecord.reason = viewerRecoveryFailed ? extraction.reason : null;
        stats.share_cards_resolved += 1;
        if (viewerRecoveryFailed) {
          stats.share_cards_unresolved += 1;
          pushUnresolvedRecord({
            messageTime,
            block,
            candidate,
            failureStage: "viewer_recovery",
            errorCode: extraction.reason,
            attemptCount: 1,
            pageIndex: scrollCount,
          });
        }
        upsertArticleState(articleStates, articleFingerprints, {
          status: viewerRecoveryFailed ? "resolved_with_recovery_failure" : "resolved",
          attempted: true,
          resolved: true,
          failed: viewerRecoveryFailed,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: candidateYBand,
        });
        if (extraction.usedBrowserFallback) {
          stats.browser_fallback_used += 1;
        }
      } else {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = extraction.reason ?? "share_card_extractor_failed";
        stats.share_cards_unresolved += 1;
        finalizeTypeOutcome(blockOutcomeObservation, "unresolved");
        pushUnresolvedRecord({
          messageTime,
          block,
          candidate,
          failureStage: viewerRecoveryFailed ? "viewer_recovery" : "link_extraction",
          errorCode: artifactRecord.reason,
          attemptCount: 1,
          pageIndex: scrollCount,
        });
        upsertArticleState(articleStates, articleFingerprints, {
          status: "failed",
          attempted: true,
          resolved: false,
          failed: true,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: candidateYBand,
        });
      }

      if (viewerRecoveryFailed) {
        limitReached = true;
        terminationReason = "viewer_recovery_failed";
        if (debug) {
          console.log("[debug] Viewer recovery failed; stopping UI scan to avoid acting on an unknown window.");
        }
        break;
      }

      if (stats.share_cards_attempted >= maxCandidates) {
        limitReached = true;
        terminationReason = "max_candidates_reached";
        if (debug) {
          console.log(`[debug] Reached max candidate limit (${maxCandidates}), stopping early.`);
        }
        break;
      }
    }

    if (reachedBeforeRange) {
      terminationReason = "reached_before_since";
      break;
    }
    if (limitReached) break;
    if (pageHasCandidateGenerationFailure) {
      terminationReason = "candidate_generation_failed";
      if (debug) {
        console.log("[debug] Failed to generate clickable candidates for actionable blocks; stopping early.");
      }
      break;
    }

    scrollCount += 1;
    if (scrollCount <= maxScrolls) {
      scrollPageFn(debug);
      stats.scrolls_performed += 1;
    } else {
      terminationReason = "max_scrolls_reached";
    }
  }

  stats.termination_reason = terminationReason ?? "unknown";
  stats.range_coverage = terminationReason === "reached_before_since"
    ? "complete"
    : INCOMPLETE_TIMELINE_TERMINATIONS.has(terminationReason)
      ? "incomplete"
      : "unverified";
  stats.oldest_visible_message_time = oldestVisibleMessageTime?.toISOString() ?? null;
  stats.type_outcomes = summarizeTypeOutcomes();

  if (artifactDir) {
    await fs.writeFile(
      path.join(artifactDir, "candidates.json"),
      JSON.stringify(candidateArtifacts, null, 2) + "\n",
      "utf8"
    );
  }

  console.log(
    `Scrolled ${stats.scrolls_performed} time(s), found ${records.length} unique link(s).`,
  );
  console.log(
    `Timeline coverage: ${stats.range_coverage} (${stats.termination_reason}; oldest visible: ${stats.oldest_visible_message_time ?? "unknown"}).`,
  );
  return { records, uncertainRecords, skippedRecords, unresolvedRecords, contentRecords, stats };
}

export async function captureVisibleUiPage(
  {
    pageIndex = 0,
    debug = false,
    artifactDir = null,
    readVisibleClipboardSnapshotFn = readVisibleClipboardSnapshot,
    prefetchedWindow = null,
    prefetchedClipboardSnapshot = null,
    prefetchedOcrResult = null,
    prefetchedScreenshotPath = null,
    prefetchedSamplingMode = null,
    previousUrlLikeSignature = null,
    forceClipboardSnapshot = false,
  } = {},
  {
    getFrontWeChatWindowFn = getWeChatChatWindow,
    captureWindowScreenshotFn = captureWindowScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
  } = {}
) {
  const window = prefetchedWindow ?? getFrontWeChatWindowFn();
  if (!window) {
    throw new Error("No WeChat window is available for UI page capture.");
  }

  const screenshotPath =
    artifactDir != null
      ? path.join(artifactDir, `page-${pageIndex}.png`)
      : path.join(os.tmpdir(), `wechat-filehelper-page-${Date.now()}-${pageIndex}.png`);

  let ocrResult = prefetchedOcrResult;
  if (prefetchedScreenshotPath && artifactDir != null && prefetchedScreenshotPath !== screenshotPath) {
    await fs.copyFile(prefetchedScreenshotPath, screenshotPath);
  } else if (!prefetchedOcrResult) {
    captureWindowScreenshotFn(window, screenshotPath);
  }

  if (!ocrResult) {
    ocrResult = await recognizeTextFromImageFn(screenshotPath);
  }
  const inferredShareCards = inferShareCardItemsFromOcr(ocrResult?.lines ?? [], {
    imageWidth: ocrResult?.width ?? window?.width ?? 0,
    imageHeight: ocrResult?.height ?? window?.height ?? 0,
  });
  const urlLikeSignature = buildUrlLikeOcrSignature(ocrResult?.lines ?? []);
  const hasUrlLikeContent = Boolean(urlLikeSignature);
  const shouldReadForUrlLikeContent =
    hasUrlLikeContent && urlLikeSignature !== previousUrlLikeSignature;
  const shouldReadForSemanticGap = !hasUrlLikeContent && inferredShareCards.length === 0;

  let clipboardSnapshot = forceClipboardSnapshot ? null : prefetchedClipboardSnapshot ?? null;
  let samplingMode = prefetchedSamplingMode ?? (prefetchedClipboardSnapshot ? "prefetched" : "ocr_only");
  const needsClipboardSnapshot =
    forceClipboardSnapshot ||
    (clipboardSnapshot == null && (shouldReadForUrlLikeContent || shouldReadForSemanticGap));

  if (needsClipboardSnapshot) {
    clipboardSnapshot = readVisibleClipboardSnapshotFn(debug);
    samplingMode = "ocr_plus_clipboard";
  }

  if (clipboardSnapshot == null) {
    clipboardSnapshot = emptyClipboardSnapshot();
  }

  const uiSnapshot = buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds: window });
  const mergedClipboardSnapshot = {
    ...clipboardSnapshot,
    blocks: uiSnapshot.effectiveBlocks,
    items: uiSnapshot.effectiveItems,
    stats: {
      ...clipboardSnapshot.stats,
      share_cards_seen:
        clipboardSnapshot.stats.share_cards_seen +
        uiSnapshot.ocrFallbackBlocks.filter((block) => Boolean(block.shareCardTitle)).length,
      share_cards_unresolved:
        clipboardSnapshot.stats.share_cards_unresolved +
        uiSnapshot.ocrFallbackBlocks.filter(
          (block) => block.shareCardTitle && !block.skipReason && getBlockDirectUrlEntries(block).length === 0
        ).length,
      skipped_by_rule: { ...clipboardSnapshot.stats.skipped_by_rule },
    },
  };

  for (const block of uiSnapshot.ocrFallbackBlocks) {
    if (block.skipReason) {
      incrementCount(mergedClipboardSnapshot.stats.skipped_by_rule, block.skipReason);
    }
  }

  if (artifactDir != null) {
    await fs.writeFile(
      path.join(artifactDir, `page-${pageIndex}.ocr.json`),
      JSON.stringify(ocrResult, null, 2) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(artifactDir, `page-${pageIndex}.clipboard.txt`),
      `${clipboardSnapshot.rawText ?? ""}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(artifactDir, `page-${pageIndex}.snapshot.json`),
      JSON.stringify(mergedClipboardSnapshot, null, 2) + "\n",
      "utf8"
    );
  } else {
    await fs.rm(screenshotPath, { force: true }).catch(() => {});
  }

  return {
    window,
    screenshotPath: artifactDir ? screenshotPath : null,
    ocrResult,
    clipboardSnapshot: mergedClipboardSnapshot,
    samplingMode,
    urlLikeSignature,
    titleMatched: uiSnapshot.titleMatched,
    candidates: uiSnapshot.candidates,
    candidateMap: new Map(uiSnapshot.candidates.map((candidate) => [candidate.itemKey, candidate])),
  };
}

function isVideoChannelViewer(viewerContext) {
  const ocrResult = viewerContext?.ocrResult;
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const normalizedLabels = new Set(VIDEO_CHANNEL_VIEWER_LABELS.map(normalizeComparableText));

  return lines.some((line) => {
    if (!line?.text) return false;
    if (imageHeight > 0 && line.y > imageHeight * 0.15) return false;
    const normalized = normalizeComparableText(line.text);
    return [...normalizedLabels].some(
      (label) => normalized.includes(label) && normalized.length <= label.length + 4
    );
  });
}

async function openVideoChannelShareMenu(
  viewerContext,
  { artifactDir = null } = {},
  {
    clickAtPointFn = clickAtPoint,
    captureRectScreenshotFn = captureRectScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    sleepMsFn = sleepMs,
  } = {}
) {
  const viewerRect = viewerContext?.screenRect ?? viewerContext?.window;
  if (!viewerRect) {
    return { copyLine: null, browserLine: null, ocrResult: { lines: [] }, screenBounds: null };
  }

  clickAtPointFn(
    viewerRect.x + viewerRect.width * VIDEO_CHANNEL_SHARE_X_RATIO,
    viewerRect.y + viewerRect.height * VIDEO_CHANNEL_SHARE_Y_RATIO
  );
  sleepMsFn(VIDEO_CHANNEL_SHARE_SETTLE_MS);

  const stamp = `${Date.now()}`;
  const screenshotPath =
    artifactDir != null
      ? path.join(artifactDir, `video-share-menu-${stamp}.png`)
      : path.join(os.tmpdir(), `wechat-video-share-menu-${stamp}.png`);
  captureRectScreenshotFn(viewerRect, screenshotPath);
  const screenBounds = viewerRect;
  const ocrResult = await recognizeTextFromImageFn(screenshotPath);
  const copyLine = findMenuActionLine(ocrResult.lines, COPY_LINK_LABELS);

  if (artifactDir != null) {
    await writeJsonArtifact(path.join(artifactDir, `video-share-menu-${stamp}.ocr.json`), ocrResult);
  } else {
    await fs.rm(screenshotPath, { force: true }).catch(() => {});
  }

  return { copyLine, browserLine: null, ocrResult, screenBounds };
}

async function openViewerMenu(
  viewerContext,
  { debug = false, artifactDir = null } = {},
  {
    clickAtPointFn = clickAtPoint,
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureRectScreenshotFn = captureRectScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    sleepMsFn = sleepMs,
  } = {}
) {
  const probeRect = viewerContext?.screenRect ?? viewerContext?.screenBounds;
  if (!probeRect) {
    return { copyLine: null, browserLine: null, ocrResult: { lines: [] }, screenBounds: null };
  }

  const probePoints = buildViewerMenuProbePoints(viewerContext);

  for (let i = 0; i < probePoints.length; i++) {
    const point = probePoints[i];
    const probeX = point.x;
    const probeY = point.y;
    if (debug) {
      console.log(
        `[debug] Probing viewer menu at ${Math.round(probeX)},${Math.round(probeY)} (probe ${i + 1}/${probePoints.length})`
      );
    }
    clickAtPointFn(probeX, probeY);
    sleepMsFn(VIEWER_MENU_SETTLE_MS);

    const stamp = `${Date.now()}-${i}`;
    const screenshotPath =
      artifactDir != null
        ? path.join(artifactDir, `menu-screen-${stamp}.png`)
        : path.join(os.tmpdir(), `wechat-menu-screen-${stamp}.png`);
    captureRectScreenshotFn(probeRect, screenshotPath);
    const screenBounds = probeRect;
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const copyLine = findMenuActionLine(ocrResult.lines, COPY_LINK_LABELS);
    const browserLine = findMenuActionLine(ocrResult.lines, OPEN_IN_BROWSER_LABELS);

    if (artifactDir != null) {
      await fs.writeFile(
        path.join(artifactDir, `menu-screen-${stamp}.ocr.json`),
        JSON.stringify(ocrResult, null, 2) + "\n",
        "utf8"
      );
    } else {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }

    if (debug && (copyLine || browserLine)) {
      console.log(`[debug] viewer menu opened on probe ${i + 1}`);
    }

    if (copyLine || browserLine) {
      return { copyLine, browserLine, ocrResult, screenBounds };
    }

    if (shouldStopViewerMenuProbing(viewerContext, getWeChatWindowsFn(), getFrontWeChatWindowFn())) {
      if (debug) {
        console.log("[debug] viewer no longer active, stopping menu probes early");
      }
      break;
    }
  }

  return {
    copyLine: null,
    browserLine: null,
    ocrResult: { lines: [] },
    screenBounds: viewerContext?.screenBounds ?? null,
  };
}

function buildViewerMenuProbePoints(viewerContext) {
  const probeRect = viewerContext?.screenRect ?? viewerContext?.screenBounds;

  return VIEWER_MENU_PROBE_POINTS.map((point) =>
    clampProbePoint(
      {
        x: probeRect.x + probeRect.width * point.xRatio,
        y: probeRect.y + probeRect.height * point.yRatio,
      },
      probeRect
    )
  );
}

function clampProbePoint(point, probeRect) {
  const minX = probeRect.x + probeRect.width * 0.68;
  const maxX = probeRect.x + probeRect.width - 12;
  const minY = probeRect.y + 8;
  const maxY = probeRect.y + Math.max(26, probeRect.height * 0.08);

  return {
    x: Math.max(minX, Math.min(maxX, point.x)),
    y: Math.max(minY, Math.min(maxY, point.y)),
  };
}

function clickOcrLineInScreen(screenBounds, line, ocrResult, clickAtPointFn = clickAtPoint) {
  if (!line) return;
  const clickPoint = mapOcrRectCenterToScreenPoint(screenBounds, line, ocrResult);
  clickAtPointFn(clickPoint.x, clickPoint.y);
}

function isSupportedWeChatViewerUrl(value) {
  return /^https:\/\/(?:mp\.weixin\.qq\.com\/|weixin\.qq\.com\/sph\/)/i.test(String(value ?? ""));
}

function isSupportedArticleViewerUrl(value) {
  try {
    const parsed = new URL(String(value ?? ""));
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "mp.weixin.qq.com" &&
      /^\/s(?:\/|$)/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isViewerRecoveryFailure(extraction) {
  return (
    extraction?.status === "failed" &&
    (
      extraction?.failureStage === "viewer_recovery" ||
      VIEWER_RECOVERY_FAILURE_REASONS.has(extraction?.reason)
    )
  );
}

function waitForClipboardWeChatUrl(
  { timeoutMs = 420, pollMs = 25 } = {},
  { readClipboardTextFn = readClipboardText, sleepMsFn = sleepMs } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clipboard = readClipboardTextFn();
    if (isSupportedWeChatViewerUrl(clipboard)) {
      return clipboard;
    }
    sleepMsFn(pollMs);
  }
  return null;
}

function viewerLooksLoading(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  return lines.some((line) => /\bloading\b/i.test(line?.text ?? ""));
}

function looksLikeArticleViewerChrome(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const chromeBottom = Math.max(64, imageHeight * 0.05);
  return lines.some(
    (line) => {
      const y = Number(line?.y);
      const height = Math.max(0, Number(line?.height ?? 0));
      return (
        Number.isFinite(y) &&
        y + height <= chromeBottom &&
        /summary\s+provided\s+by\s+yuanbao/i.test(line?.text ?? "")
      );
    },
  );
}

function removeImageViewerChromeOcr(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const toolbarBottom = Math.max(64, imageHeight * 0.05);
  return {
    ...ocrResult,
    lines: lines.filter((line) => {
      const y = Number(line?.y);
      if (!Number.isFinite(y)) return true;
      const height = Math.max(0, Number(line?.height ?? 0));
      return y + height > toolbarBottom;
    }),
  };
}

async function captureImageViewerOcrWhenReady(
  screenRect,
  screenshotPath,
  { debug = false } = {},
  {
    captureRectScreenshotFn = captureRectScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    sleepMsFn = sleepMs,
  } = {},
) {
  let ocrResult = { lines: [] };

  for (let attempt = 1; attempt <= IMAGE_VIEWER_READY_ATTEMPTS; attempt += 1) {
    captureRectScreenshotFn(screenRect, screenshotPath);
    ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const contentLines = removeImageViewerChromeOcr(ocrResult).lines.filter((line) =>
      String(line?.text ?? "").trim(),
    );
    if (!viewerLooksLoading(ocrResult) && contentLines.length > 0) {
      return ocrResult;
    }
    if (attempt < IMAGE_VIEWER_READY_ATTEMPTS) {
      if (debug) {
        console.log(
          `[debug] Image viewer has no loaded content yet; retrying (${attempt}/${IMAGE_VIEWER_READY_ATTEMPTS})...`,
        );
      }
      sleepMsFn(IMAGE_VIEWER_READY_POLL_MS);
    }
  }

  return ocrResult;
}

function removeArticleViewerHintOcr(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const chromeBottom = Math.max(64, imageHeight * 0.05);
  return {
    ...ocrResult,
    lines: lines.filter((line) => {
      const y = Number(line?.y);
      const height = Math.max(0, Number(line?.height ?? 0));
      if (!Number.isFinite(y) || y + height > chromeBottom) return true;
      return !(
        /\bloading\b/i.test(line?.text ?? "") ||
        /summary\s+provided\s+by\s+yuanbao/i.test(line?.text ?? "")
      );
    }),
  };
}

function shouldStopViewerMenuProbing(viewerContext, currentWindows, frontWindow) {
  if (!viewerContext?.window || viewerContext.mode === "ocr_detected") {
    return false;
  }

  const expectedSignature = windowSignature(viewerContext.window);
  const stillPresent = currentWindows.some((window) => windowSignature(window) === expectedSignature);
  if (!stillPresent) {
    return true;
  }

  if (!frontWindow) {
    return false;
  }

  return windowSignature(frontWindow) !== expectedSignature;
}

function windowSignature(window) {
  if (!window) return "";
  return [
    window.name ?? "",
    Math.round(Number(window.x ?? 0)),
    Math.round(Number(window.y ?? 0)),
    Math.round(Number(window.width ?? 0)),
    Math.round(Number(window.height ?? 0)),
  ].join("|");
}

function looksLikeFileHelperWindow(window) {
  const normalized = normalizeComparableText(window?.name ?? "");
  if (!normalized) return false;
  return FILE_HELPER_NAMES.some((name) => {
    const expected = normalizeComparableText(name);
    return normalized.includes(expected) || expected.includes(normalized);
  });
}

function normalizeCloseViewerResult(result, beforeWindows, getFrontWeChatWindowFn = getFrontWeChatWindow) {
  if (typeof result === "boolean") {
    return {
      closed: result,
      currentWindows: result ? beforeWindows : null,
      frontWindow: getFrontWeChatWindowFn(),
      usedCommandW: !result,
    };
  }

  return {
    closed: Boolean(result?.closed),
    currentWindows: Array.isArray(result?.currentWindows) ? result.currentWindows : null,
    frontWindow: result?.frontWindow ?? getFrontWeChatWindowFn(),
    usedCommandW: Boolean(result?.usedCommandW),
  };
}

function fastChatRecoveryLooksGood(beforeWindows, currentWindows, frontWindow) {
  if (!Array.isArray(currentWindows) || currentWindows.length > beforeWindows.length) {
    return false;
  }
  if (!frontWindow) return false;

  const beforeSignatures = new Set(beforeWindows.map(windowSignature));
  return beforeSignatures.has(windowSignature(frontWindow)) || looksLikeFileHelperWindow(frontWindow);
}

function findViewerTitleLine(ocrResult, candidate) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const titleNorm = normalizeComparableText(candidate?.title ?? candidate?.rawText ?? "");
  if (!titleNorm) return null;

  let best = null;
  for (const line of lines) {
    if (!line?.text) continue;
    if (imageHeight > 0 && line.y > imageHeight * 0.45) continue;
    const normalized = normalizeComparableText(line.text);
    if (!normalized || normalized.length < 6) continue;

    let score = 0;
    if (normalized.includes(titleNorm)) score += 30;
    else if (titleNorm.includes(normalized) && normalized.length >= 8) score += 22;
    else {
      const probe = titleNorm.slice(0, Math.min(titleNorm.length, 14));
      if (probe && normalized.includes(probe)) score += 18;
      else if (probe && probe.includes(normalized) && normalized.length >= 6) score += 12;
    }

    if (line.width >= 260) score += 3;
    if (line.height >= 26) score += 2;
    if (score < 12) continue;

    if (!best || score > best.score || (score === best.score && line.y < best.line.y)) {
      best = { line, score };
    }
  }

  return best?.line ?? null;
}

function analyzeViewerOcr(ocrResult, candidate) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageWidth = Number(ocrResult?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? 0);
  const titleLine = findViewerTitleLine(ocrResult, candidate);
  const chatHistoryModal = lines.some((line) => /chat history with/i.test(line.text));
  if (!titleLine || chatHistoryModal) {
    return {
      matched: false,
      titleLine,
      chatHistoryModal,
      contentLines: 0,
      metadataLines: 0,
    };
  }

  const contentLines = lines.filter(
    (line) =>
      line.text &&
      line.y > titleLine.y + titleLine.height * 1.2 &&
      line.y < imageHeight * 0.92 &&
      line.x > titleLine.x - imageWidth * 0.08 &&
      line.x < titleLine.x + imageWidth * 0.18 &&
      line.width > Math.max(140, imageWidth * 0.14)
  ).length;
  const metadataLines = lines.filter(
    (line) =>
      line.text &&
      line.y >= titleLine.y - 24 &&
      line.y <= titleLine.y + 120 &&
      /原创|original|summary provided|年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}|数字生命|yuanbao/i.test(line.text)
  ).length;

  return {
    matched: contentLines >= 4 && (metadataLines >= 1 || titleLine.width >= imageWidth * 0.2),
    titleLine,
    chatHistoryModal,
    contentLines,
    metadataLines,
  };
}

function writeJsonArtifact(filePath, value) {
  return fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function detectViewerContext(
  beforeWindows,
  candidate,
  { debug = false, artifactDir = null, timeoutMs = VIEWER_DETECT_TIMEOUT_MS, pollMs = VIEWER_DETECT_POLL_MS } = {},
  {
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureFullScreenScreenshotFn = captureFullScreenScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    sleepMsFn = sleepMs,
  } = {}
) {
  const beforeFrontWindow = beforeWindows[0] ?? null;
  const beforeSignatures = new Set(beforeWindows.map(windowSignature));
  const beforeFrontSignature = windowSignature(beforeFrontWindow);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentWindows = getWeChatWindowsFn();
    const frontWindow = getFrontWeChatWindowFn();

    const stamp = `${Date.now()}`;
    const screenshotPath =
      artifactDir != null
        ? path.join(artifactDir, `viewer-detect-${stamp}.png`)
        : path.join(os.tmpdir(), `wechat-viewer-detect-${stamp}.png`);

    const screenBounds = captureFullScreenScreenshotFn(screenshotPath);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const ocrAnalysis = analyzeViewerOcr(ocrResult, candidate);

    if (artifactDir != null) {
      await writeJsonArtifact(path.join(artifactDir, `viewer-detect-${stamp}.ocr.json`), ocrResult);
    } else {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }

    const newWindow =
      currentWindows.length > beforeWindows.length
        ? currentWindows.find((window) => !beforeSignatures.has(windowSignature(window)))
        : null;
    if (newWindow) {
      return {
        mode: "new_window",
        screenRect: newWindow,
        screenBounds,
        window: newWindow,
        ocrResult,
        ocrAnalysis,
      };
    }

    if (frontWindow && windowSignature(frontWindow) !== beforeFrontSignature) {
      return {
        mode: "front_window_changed",
        screenRect: frontWindow,
        screenBounds,
        window: frontWindow,
        ocrResult,
        ocrAnalysis,
      };
    }

    if (ocrAnalysis.matched) {
      if (debug) {
        console.log("[debug] Detected article viewer via full-screen OCR");
      }
      return {
        mode: "ocr_detected",
        screenRect: frontWindow ?? screenBounds,
        screenBounds,
        window: frontWindow ?? null,
        ocrResult,
        ocrAnalysis,
      };
    }

    sleepMsFn(pollMs);
  }

  return null;
}

async function waitForViewerReady(
  viewerContext,
  candidate,
  { debug = false, artifactDir = null, timeoutMs = VIEWER_READY_TIMEOUT_MS, pollMs = VIEWER_READY_POLL_MS } = {},
  {
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureFullScreenScreenshotFn = captureFullScreenScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    sleepMsFn = sleepMs,
  } = {}
) {
  let currentContext = viewerContext;
  if (isVideoChannelViewer(currentContext)) {
    return currentContext;
  }
  const initiallyLoading = viewerLooksLoading(currentContext?.ocrResult);
  const initiallyReady = !initiallyLoading && Boolean(currentContext?.ocrAnalysis?.titleLine);

  if (initiallyReady) {
    return currentContext;
  }

  if (debug) {
    console.log("[debug] Waiting for article viewer to finish loading...");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    sleepMsFn(pollMs);

    const stamp = `${Date.now()}`;
    const screenshotPath =
      artifactDir != null
        ? path.join(artifactDir, `viewer-ready-${stamp}.png`)
        : path.join(os.tmpdir(), `wechat-viewer-ready-${stamp}.png`);

    const screenBounds = captureFullScreenScreenshotFn(screenshotPath);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const ocrAnalysis = analyzeViewerOcr(ocrResult, candidate);
    const frontWindow = getFrontWeChatWindowFn();

    currentContext = {
      ...currentContext,
      screenBounds,
      screenRect: currentContext.screenRect ?? frontWindow ?? screenBounds,
      window: frontWindow ?? currentContext.window ?? null,
      ocrResult,
      ocrAnalysis,
    };

    if (artifactDir != null) {
      await writeJsonArtifact(path.join(artifactDir, `viewer-ready-${stamp}.ocr.json`), ocrResult);
    } else {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }

    if (!viewerLooksLoading(ocrResult) && (ocrAnalysis.titleLine || ocrAnalysis.matched)) {
      return currentContext;
    }
  }

  return currentContext;
}

function closeViewerWindow(
  beforeWindows,
  { debug = false } = {},
  {
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    sendKeyCodeFn = sendKeyCode,
    sendKeystrokeFn = sendKeystroke,
    sleepMsFn = sleepMs,
    activateWeChatFn = activateWeChat,
  } = {}
) {
  activateWeChatFn();
  sleepMsFn(VIEWER_CLOSE_INITIAL_SETTLE_MS);
  sendKeyCodeFn(53);
  sleepMsFn(VIEWER_CLOSE_ESCAPE_SETTLE_MS);

  const beforeCount = beforeWindows.length;
  let currentWindows = getWeChatWindowsFn();
  let frontWindow = getFrontWeChatWindowFn();
  if (currentWindows.length <= beforeCount) {
    return {
      closed: true,
      currentWindows,
      frontWindow,
      usedCommandW: false,
    };
  }

  sendKeystrokeFn("w", ["command down"]);
  sleepMsFn(VIEWER_CLOSE_CMD_W_SETTLE_MS);

  currentWindows = getWeChatWindowsFn();
  frontWindow = getFrontWeChatWindowFn();
  const closed = currentWindows.length <= beforeCount;
  if (debug && !closed) {
    console.log("[debug] viewer window did not close cleanly");
  }
  return {
    closed,
    currentWindows,
    frontWindow,
    usedCommandW: true,
  };
}

async function verifyChatRecovered(
  { debug = false, artifactDir = null } = {},
  {
    getFrontWeChatWindowFn = getWeChatChatWindow,
    captureWindowScreenshotFn = captureWindowScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
  } = {}
) {
  const window = getFrontWeChatWindowFn();
  if (!window) return false;

  const label = `post-viewer-${Date.now()}`;
  const screenshotPath =
    artifactDir != null
      ? path.join(artifactDir, `${label}.png`)
      : path.join(os.tmpdir(), `wechat-filehelper-${label}.png`);

  try {
    captureWindowScreenshotFn(window, screenshotPath);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    if (artifactDir != null) {
      await writeJsonArtifact(path.join(artifactDir, `${label}.ocr.json`), ocrResult);
    }
    return Boolean(findFileHelperTitleLine(ocrResult.lines, ocrResult.height ?? window.height));
  } catch {
    return false;
  } finally {
    if (artifactDir == null) {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }
  }
}

async function detectImageViewerContext(
  beforeWindows,
  beforeFrontWindow,
  { timeoutMs = VIEWER_DETECT_TIMEOUT_MS, pollMs = VIEWER_DETECT_POLL_MS } = {},
  {
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    sleepMsFn = sleepMs,
  } = {},
) {
  const beforeSignatures = new Set(beforeWindows.map(windowSignature));
  const beforeFrontSignature = windowSignature(beforeFrontWindow ?? beforeWindows[0] ?? null);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentWindows = getWeChatWindowsFn();
    const frontWindow = getFrontWeChatWindowFn();
    const newWindow = currentWindows.find(
      (window) => !beforeSignatures.has(windowSignature(window)),
    );
    if (newWindow) {
      return { mode: "new_window", screenRect: newWindow, window: newWindow };
    }
    if (frontWindow && windowSignature(frontWindow) !== beforeFrontSignature) {
      return { mode: "front_window_changed", screenRect: frontWindow, window: frontWindow };
    }
    sleepMsFn(pollMs);
  }

  return null;
}

export async function extractImageContent(
  candidate,
  {
    debug = false,
    artifactDir = null,
    capturedAt = new Date(),
    messageTime = capturedAt,
    messageTimeSource = "visible_timestamp",
    chatName = FILE_HELPER_CHAT_NAME,
    captureSessionId = newCaptureSessionId(),
  } = {},
  {
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    clickAtPointFn = clickAtPoint,
    sleepMsFn = sleepMs,
    detectImageViewerContextFn = detectImageViewerContext,
    captureRectScreenshotFn = captureRectScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    createImageContentRecordFn = createImageContentRecord,
    publishImageContentRecordFn = publishImageContentRecord,
    closeViewerWindowFn = closeViewerWindow,
    verifyChatRecoveredFn = verifyChatRecovered,
    recoverChatFn = null,
    fsImpl = fs,
  } = {},
) {
  const timings = {
    viewer_open_wait_ms: 0,
    viewer_ready_wait_ms: 0,
    viewer_menu_wait_ms: 0,
    viewer_copy_wait_ms: 0,
    viewer_close_wait_ms: 0,
    image_ocr_wait_ms: 0,
  };
  const beforeWindows = getWeChatWindowsFn();
  const beforeFrontWindow = getFrontWeChatWindowFn() ?? beforeWindows[0] ?? null;
  const openStartedAt = Date.now();
  clickAtPointFn(candidate.clickX, candidate.clickY);
  sleepMsFn(VIEWER_OPEN_SETTLE_MS);
  const viewerContext = await detectImageViewerContextFn(
    beforeWindows,
    beforeFrontWindow,
    { debug, artifactDir },
    { getWeChatWindowsFn, getFrontWeChatWindowFn, sleepMsFn },
  );
  timings.viewer_open_wait_ms = Date.now() - openStartedAt;

  if (!viewerContext?.screenRect) {
    let recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    if (!recovered && typeof recoverChatFn === "function") {
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    return {
      status: "failed",
      reason: recovered ? "image_viewer_not_opened" : "image_candidate_chat_not_recovered",
      failureStage: recovered ? "viewer_open" : "viewer_recovery",
      record: null,
      artifactPath: null,
      timings,
    };
  }

  const safeItemKey = String(candidate.itemKey ?? "image").replace(/[^A-Za-z0-9._-]+/g, "-");
  const screenshotPath =
    artifactDir != null
      ? path.join(artifactDir, `image-viewer-${safeItemKey}-${Date.now()}.png`)
      : path.join(os.tmpdir(), `wechat-image-viewer-${process.pid}-${Date.now()}.png`);
  let result = {
    status: "failed",
    reason: "image_ocr_failed",
    failureStage: "image_ocr",
    record: null,
    artifactPath: screenshotPath,
    timings,
  };

  try {
    if (artifactDir != null) {
      await fsImpl.mkdir(artifactDir, { recursive: true });
    }
    const ocrStartedAt = Date.now();
    const ocrResult = await captureImageViewerOcrWhenReady(
      viewerContext.screenRect,
      screenshotPath,
      { debug },
      { captureRectScreenshotFn, recognizeTextFromImageFn, sleepMsFn },
    );
    timings.image_ocr_wait_ms = Date.now() - ocrStartedAt;
    if (artifactDir != null) {
      await writeJsonArtifact(
        path.join(artifactDir, `image-viewer-${safeItemKey}.ocr.json`),
        ocrResult,
      );
    }

    const articleTypeHint = looksLikeArticleViewerChrome(ocrResult);
    const contentOcrResult = removeImageViewerChromeOcr(ocrResult);
    const recordOcrResult = articleTypeHint
      ? removeArticleViewerHintOcr(contentOcrResult)
      : contentOcrResult;
    let record;
    try {
      record = createImageContentRecordFn({
        capturedAt,
        messageTime,
        messageTimeSource,
        chatName,
        title: candidate.title ?? "",
        captureSessionId,
        source: "ui",
        ocrResult: recordOcrResult,
      });
    } catch (error) {
      result = {
        ...result,
        reason: error?.code || "image_ocr_failed",
        failureStage: "image_ocr",
      };
      record = null;
    }

    if (articleTypeHint) {
      result = {
        ...result,
        status: "type_hint",
        reason: "image_candidate_opened_article_viewer",
        failureStage: "viewer_type",
        actualContentType: "article",
        record,
      };
    } else if (record) {
      try {
        const published = await publishImageContentRecordFn(record);
        result = {
          ...result,
          status: "ok",
          reason: null,
          failureStage: null,
          record:
            published.pkm_status === "needs_review" && artifactDir != null
              ? { ...published, review_artifact_path: screenshotPath }
              : published,
        };
      } catch (error) {
        result = {
          ...result,
          reason: error?.code || "image_note_write_failed",
          failureStage: "pkm_write",
          record: {
            ...record,
            pkm_status: "write_failed",
            ...(artifactDir != null ? { artifact_path: screenshotPath } : {}),
          },
        };
      }
    }
  } catch (error) {
    result = {
      ...result,
      reason: error?.code || "image_ocr_failed",
      failureStage: "image_ocr",
    };
  } finally {
    const closeStartedAt = Date.now();
    const closeResult = normalizeCloseViewerResult(
      closeViewerWindowFn(beforeWindows, { debug }),
      beforeWindows,
      getFrontWeChatWindowFn,
    );
    let recovered = false;
    if (
      closeResult.closed &&
      fastChatRecoveryLooksGood(beforeWindows, closeResult.currentWindows, closeResult.frontWindow)
    ) {
      recovered = true;
    } else {
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!recovered && typeof recoverChatFn === "function") {
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!closeResult.closed || !recovered) {
      result = {
        ...result,
        status: "failed",
        reason: !closeResult.closed ? "image_viewer_not_closed" : "image_chat_not_recovered",
        failureStage: "viewer_recovery",
      };
    }
    timings.viewer_close_wait_ms = Date.now() - closeStartedAt;

    const shouldRemoveScreenshot =
      artifactDir == null ||
      (result.status === "ok" && result.record?.pkm_status === "written");
    if (shouldRemoveScreenshot) {
      await fsImpl.rm(screenshotPath, { force: true }).catch(() => {});
      result.artifactPath = null;
    }
  }

  return result;
}

export async function extractShareCardUrl(
  candidate,
  { debug = false, artifactDir = null, allowBrowserFallback = true } = {},
  {
    clearClipboardTextFn = clearClipboardText,
    clickAtPointFn = clickAtPoint,
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureFullScreenScreenshotFn = captureFullScreenScreenshot,
    captureRectScreenshotFn = captureRectScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    detectViewerContextFn = detectViewerContext,
    waitForViewerReadyFn = waitForViewerReady,
    openViewerMenuFn = openViewerMenu,
    openVideoChannelShareMenuFn = openVideoChannelShareMenu,
    readClipboardTextFn = readClipboardText,
    readFrontBrowserUrlFromAddressBarFn = readFrontBrowserUrlFromAddressBar,
    sleepMsFn = sleepMs,
    closeViewerWindowFn = closeViewerWindow,
    verifyChatRecoveredFn = verifyChatRecovered,
    recoverChatFn = null,
  } = {}
) {
  const timings = {
    viewer_open_wait_ms: 0,
    viewer_ready_wait_ms: 0,
    viewer_menu_wait_ms: 0,
    viewer_copy_wait_ms: 0,
    viewer_close_wait_ms: 0,
  };
  const beforeWindows = getWeChatWindowsFn();
  clearClipboardTextFn();

  const openStartedAt = Date.now();
  clickAtPointFn(candidate.clickX, candidate.clickY);
  sleepMsFn(VIEWER_OPEN_SETTLE_MS);

  let viewerContext = await detectViewerContextFn(
    beforeWindows,
    candidate,
    { debug, artifactDir },
    {
      getWeChatWindowsFn,
      getFrontWeChatWindowFn,
      captureFullScreenScreenshotFn,
      recognizeTextFromImageFn,
      sleepMsFn,
    }
  );

  if (!viewerContext && candidate.matchReason === "cluster_fallback") {
    const retryY = Math.max(0, candidate.clickY - OCR_CLUSTER_OPEN_RETRY_OFFSET_POINTS);
    if (debug) {
      console.log(`[debug] Retrying OCR-only card above text cluster at ${candidate.clickX},${retryY}`);
    }
    clickAtPointFn(candidate.clickX, retryY);
    sleepMsFn(VIEWER_OPEN_SETTLE_MS);
    viewerContext = await detectViewerContextFn(
      beforeWindows,
      candidate,
      { debug, artifactDir },
      {
        getWeChatWindowsFn,
        getFrontWeChatWindowFn,
        captureFullScreenScreenshotFn,
        recognizeTextFromImageFn,
        sleepMsFn,
      }
    );
  }
  timings.viewer_open_wait_ms = Date.now() - openStartedAt;

  if (!viewerContext) {
    return { status: "failed", reason: "share_card_viewer_not_opened", timings };
  }

  const readyStartedAt = Date.now();
  const readyViewerContext = await waitForViewerReadyFn(
    viewerContext,
    candidate,
    { debug, artifactDir },
    {
      getFrontWeChatWindowFn,
      captureFullScreenScreenshotFn,
      recognizeTextFromImageFn,
      sleepMsFn,
    }
  );
  timings.viewer_ready_wait_ms = Date.now() - readyStartedAt;
  const videoChannelViewer = isVideoChannelViewer(readyViewerContext);

  if (artifactDir != null) {
    await writeJsonArtifact(path.join(artifactDir, "viewer-context.json"), {
      viewer_kind: videoChannelViewer ? "video_channel" : "article",
      mode: readyViewerContext.mode,
      screen_rect: readyViewerContext.screenRect,
      screen_bounds: readyViewerContext.screenBounds,
      window: readyViewerContext.window,
      title_line_text: readyViewerContext.ocrAnalysis?.titleLine?.text ?? null,
      content_lines: readyViewerContext.ocrAnalysis?.contentLines ?? 0,
      metadata_lines: readyViewerContext.ocrAnalysis?.metadataLines ?? 0,
    });
  }

  let url = null;
  let usedBrowserFallback = false;
  let reason = videoChannelViewer
    ? "video_channel_copy_link_not_found"
    : "viewer_detected_but_menu_not_found";
  let status = "failed";

  try {
    const menuStartedAt = Date.now();
    const openMenuFn = videoChannelViewer ? openVideoChannelShareMenuFn : openViewerMenuFn;
    const menu = await openMenuFn(
      readyViewerContext,
      { debug, artifactDir },
      {
        clickAtPointFn,
        getWeChatWindowsFn,
        getFrontWeChatWindowFn,
        captureFullScreenScreenshotFn,
        captureRectScreenshotFn,
        recognizeTextFromImageFn,
        sleepMsFn,
      }
    );
    timings.viewer_menu_wait_ms = Date.now() - menuStartedAt;

    if (menu.copyLine) {
      const copyStartedAt = Date.now();
      clickOcrLineInScreen(
        menu.screenBounds ?? readyViewerContext.screenBounds,
        menu.copyLine,
        menu.ocrResult,
        clickAtPointFn
      );
      if (VIEWER_COPY_SETTLE_MS > 0) {
        sleepMsFn(VIEWER_COPY_SETTLE_MS);
      }
      url = waitForClipboardWeChatUrl({}, { readClipboardTextFn, sleepMsFn });
      timings.viewer_copy_wait_ms += Date.now() - copyStartedAt;
      if (url) {
        status = "ok";
      }
      if (!url) {
        reason = "copy_link_failed";
      }
    }

    if (!url && allowBrowserFallback && menu.browserLine) {
      const copyStartedAt = Date.now();
      clickOcrLineInScreen(
        menu.screenBounds ?? readyViewerContext.screenBounds,
        menu.browserLine,
        menu.ocrResult,
        clickAtPointFn
      );
      sleepMsFn(VIEWER_BROWSER_SETTLE_MS);
      const browserUrl = readFrontBrowserUrlFromAddressBarFn();
      if (isSupportedWeChatViewerUrl(browserUrl)) {
        usedBrowserFallback = true;
        url = browserUrl;
        status = "ok";
      }
      timings.viewer_copy_wait_ms += Date.now() - copyStartedAt;
      if (!url) {
        reason = "browser_fallback_failed";
      }
    }
  } finally {
    const closeStartedAt = Date.now();
    const closeResult = normalizeCloseViewerResult(
      closeViewerWindowFn(beforeWindows, { debug }),
      beforeWindows,
      getFrontWeChatWindowFn
    );
    const closed = closeResult.closed;
    let recovered = false;

    if (closed && fastChatRecoveryLooksGood(beforeWindows, closeResult.currentWindows, closeResult.frontWindow)) {
      recovered = true;
    } else {
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }

    if (!recovered && typeof recoverChatFn === "function") {
      if (debug) {
        console.log("[debug] Chat recovery failed, re-opening 文件传输助手...");
      }
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!closed || !recovered) {
      reason = !closed ? "viewer_not_closed" : "chat_not_recovered";
      status = "failed";
    }
    timings.viewer_close_wait_ms = Date.now() - closeStartedAt;
  }

  return { status, reason, usedBrowserFallback, url, timings };
}
