import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  activateWeChat,
  captureFullScreenScreenshot,
  captureWindowScreenshot,
  clearClipboardText,
  clickAtPoint,
  getFrontWeChatWindow,
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
import { probeVisionAvailability, recognizeTextFromImage } from "./ocr.js";

const FILE_HELPER_NAMES = [
  FILE_HELPER_CHAT_NAME,
  "File Transfer Assistant",
  "File Transfer",
  "filehelper",
];
const COPY_LINK_LABELS = ["复制链接", "copy link"];
const OPEN_IN_BROWSER_LABELS = ["使用默认浏览器打开", "默认浏览器打开", "open in default browser"];
const VIEWER_MENU_ANCHOR_LABELS = [
  "summary provided by yuanbao",
  "summary provided",
  "yuanbao",
];
const VIEWER_MENU_PROBE_POINTS = [
  { xRatio: 0.955, yRatio: 0.022 },
  { xRatio: 0.94, yRatio: 0.022 },
  { xRatio: 0.97, yRatio: 0.022 },
  { xRatio: 0.955, yRatio: 0.032 },
  { xRatio: 0.94, yRatio: 0.032 },
];
const BILIBILI_BRAND_TOKENS = ["哔哩哔哩", "bilibili", "b23tv", "bolilbi", "bolibili", "bililbi", "blbl"];
const OCR_RIGHT_PANE_RATIO = 0.56;
const OCR_TOP_CONTENT_RATIO = 0.15;
const OCR_CLUSTER_GAP_PX = 54;
const OCR_FOOTER_MERGE_MAX_GAP_PX = 150;
const OCR_TIMESTAMP_MIN_RATIO = 0.60;
const OCR_TIMESTAMP_MAX_RATIO = 0.82;
const OCR_TIMESTAMP_BEFORE_MAX_GAP_PX = 180;
const OCR_TIMESTAMP_AFTER_MAX_GAP_PX = 40;
const OCR_TIMESTAMP_FALLBACK_MAX_INDEX_GAP = 4;
const OCR_TIMESTAMP_FALLBACK_MAX_Y_GAP_PX = 420;
const VIEWER_OPEN_SETTLE_MS = 160;
const VIEWER_DETECT_TIMEOUT_MS = 900;
const VIEWER_DETECT_POLL_MS = 60;
const VIEWER_READY_TIMEOUT_MS = 8000;
const VIEWER_READY_POLL_MS = 40;
const VIEWER_MENU_SETTLE_MS = 45;
const VIEWER_COPY_SETTLE_MS = 0;
const VIEWER_BROWSER_SETTLE_MS = 500;
const VIEWER_CLOSE_INITIAL_SETTLE_MS = 5;
const VIEWER_CLOSE_ESCAPE_SETTLE_MS = 20;
const VIEWER_CLOSE_CMD_W_SETTLE_MS = 35;
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_SHARE_CARD_TYPES = new Set(["single_article_card", "text_share_card"]);
const ARTICLE_RETRY_LIMIT = 2;
const RETRYABLE_EXTRACTION_REASONS = new Set([
  "viewer_not_ready",
  "viewer_context_mismatch",
  "viewer_detected_but_menu_not_found",
]);
const SOFT_OCR_SKIP_REASONS = new Set(["unsupported_ocr_card", "weak_ocr_card"]);

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

  const clusters = [];
  let currentCluster = [];
  for (const line of candidateLines) {
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
  const mergedClusters = mergeIsolatedArticleFooterClusters(clusters);
  timestampLines.sort((a, b) => a.y - b.y);

  const items = [];
  let index = 0;
  for (const cluster of mergedClusters) {
    if (cluster.length < 2) continue;

    const rawLines = cluster.map((line) => String(line?.text ?? "").trim()).filter(Boolean);
    const rawText = rawLines.join(" ").trim();
    if (!rawText) continue;

    const title = cluster
      .slice(0, Math.min(cluster.length, 2))
      .map((line) => line.text)
      .join(" ")
      .trim();
    const timestampLine = findNearestTimestampLine(cluster[0], timestampLines);
    const skipReason = classifyOcrShareCardSkipReason(rawText, rawLines);
    const cardType = inferSupportedShareCardType(rawLines, rawText, skipReason);

    items.push({
      kind: "share_card",
      itemKey: `ocr-item-${index++}`,
      timestampText: timestampLine?.text ?? null,
      rawText,
      title,
      skipReason,
      cardType,
      ocrCluster: cluster,
    });
  }

  return items;
}

function clusterBottom(cluster) {
  return Math.max(...cluster.map((line) => Number(line?.y ?? 0) + Number(line?.height ?? 0)));
}

function clusterVerticalGap(upperCluster, lowerCluster) {
  const upperBottom = clusterBottom(upperCluster);
  const lowerTop = Math.min(...lowerCluster.map((line) => Number(line?.y ?? Number.POSITIVE_INFINITY)));
  if (!Number.isFinite(upperBottom) || !Number.isFinite(lowerTop)) return Number.POSITIVE_INFINITY;
  return lowerTop - upperBottom;
}

function clusterRawLines(cluster) {
  return Array.isArray(cluster)
    ? cluster.map((line) => String(line?.text ?? "").normalize("NFKC").trim()).filter(Boolean)
    : [];
}

function isIsolatedArticleSourceFooterCluster(cluster) {
  const rawLines = clusterRawLines(cluster);
  if (rawLines.length === 0 || rawLines.length > 2) return false;
  return rawLines.every((line) => looksLikeArticleSourceFooter(line));
}

function canAcceptIsolatedArticleSourceFooter(cluster) {
  const rawLines = clusterRawLines(cluster);
  if (rawLines.length === 0) return false;
  if (rawLines.some((line) => looksLikeTimestampOcrText(line) || looksLikeUrlLikeText(line))) return false;

  const rawText = rawLines.join("\n");
  if (looksLikeVideoChannelText(rawText, rawLines) || looksLikeBilibiliVideoText(rawText)) return false;
  if (looksLikeMarkdownDocText(rawText, rawLines) || looksLikeFileCardText(rawText)) return false;
  if (looksLikeImageCardText(rawLines, rawText) || looksLikePlainTextBlock(rawLines, rawText)) return false;
  if (looksLikeSingleArticleCardText(rawLines, rawText)) return false;

  return rawLines.some((line) => {
    const signature = normalizeArticleSignatureLine(line);
    if (signature.length < 8) return false;
    if (looksLikeSingleLineArticleTitleCue(line)) return true;
    if (looksLikeArticleSourceFooter(line)) return false;
    return true;
  });
}

function looksLikeSingleLineArticleTitleCue(text) {
  const value = String(text ?? "").normalize("NFKC").trim();
  if (!value) return false;
  return /《[^》]{2,}》/.test(value) || (/[|｜]/.test(value) && normalizeComparableText(value).length >= 8);
}

function mergeIsolatedArticleFooterClusters(clusters) {
  const merged = [];
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index];
    const nextCluster = clusters[index + 1];
    if (
      nextCluster &&
      clusterVerticalGap(cluster, nextCluster) <= OCR_FOOTER_MERGE_MAX_GAP_PX &&
      isIsolatedArticleSourceFooterCluster(nextCluster) &&
      canAcceptIsolatedArticleSourceFooter(cluster)
    ) {
      merged.push([...cluster, ...nextCluster]);
      index += 1;
      continue;
    }
    merged.push(cluster);
  }
  return merged;
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

function looksLikeMarkdownDocText(text, rawLines = []) {
  const value = String(text ?? "").normalize("NFKC");
  if (!/\.(?:md|markdown)(?:$|[\s)）】\]])/i.test(value)) return false;

  const lines = Array.isArray(rawLines)
    ? rawLines.map((line) => String(line ?? "").trim()).filter(Boolean)
    : value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

  return lines.some((line) => /^[A-Za-z0-9][A-Za-z0-9._/\- ]{1,120}\.(?:md|markdown)$/i.test(line));
}

function looksLikeFileCardText(text) {
  return /(?:^|[\s(（【\[])[\w./-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|rtf|pages|numbers|key|zip|tar|gz)(?:$|[\s)）】\]])/i.test(
    String(text ?? "")
  );
}

function looksLikeImageCardText(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  const text = lines.join(" ").normalize("NFKC").trim();
  if (!text) return false;
  if (/^(?:\[?\s*)?(?:图片|照片|image|photo)(?:\s*\]?)?$/i.test(text)) return true;
  if (/^(?:一张|多张)?(?:图片|照片)$/i.test(text)) return true;
  return lines.length <= 3 && /\b(?:image|photo)\b/i.test(text) && /图片|照片|image|photo/i.test(text);
}

function looksLikeWeakOcrShareCardText(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  if (lines.length === 0 || lines.length > 2) return false;
  if (looksLikeTextShareCardText(lines, rawText)) return false;
  if (lines.some((line) => looksLikeUrlLikeText(line) || looksLikeTimestampOcrText(line))) return false;

  const text = lines.join(" ").normalize("NFKC").trim();
  const normalizedLines = lines.map(normalizeComparableText).filter(Boolean);
  const combined = normalizedLines.join("");
  if (!combined) return true;
  if (combined.length <= 8) return true;

  const first = normalizedLines[0] ?? "";
  const secondText = lines[1] ?? "";
  const second = normalizedLines[1] ?? "";
  const hasSentenceCue = /[，,。！？；!?、:：]/.test(text);
  const secondLooksLikeBrandFragment =
    looksLikeArticleSourceFooter(secondText) || /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,20}$/.test(secondText);

  return (
    lines.length === 2 &&
    first.length <= 2 &&
    second.length <= 18 &&
    !hasSentenceCue &&
    secondLooksLikeBrandFragment
  );
}

function looksLikeArticleMetadataLine(text) {
  return /^(原创|作者[:：]?|by\b|来源[:：]?|公众号|发布于|阅读原文|微信公众平台|阅读|link|链接)$/i.test(
    String(text ?? "").trim()
  );
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

function looksLikeTextShareCardText(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  if (lines.length < 2) return false;
  const headerLines = lines.slice(0, Math.min(lines.length, 2));
  return headerLines.some((line) => /文字分享/.test(line));
}

function looksLikeArticleSourceFooter(text) {
  const value = String(text ?? "").normalize("NFKC").trim();
  if (!value) return false;
  if (looksLikeUrlLikeText(value) || looksLikeTimestampOcrText(value)) return false;
  if (looksLikeVideoChannelText(value, [value]) || looksLikeBilibiliVideoText(value)) return false;
  if (/^(?:图片|照片|image|photo)$/i.test(value)) return false;
  if (/[\d.]+\s*(?:KB|MB|GB|页|pages?)\b/i.test(value)) return false;
  if (/[，,。！？；!?、]/.test(value)) return false;

  const normalized = normalizeComparableText(value);
  return normalized.length >= 2 && normalized.length <= 24;
}

function looksLikeSingleArticleCardText(rawLines, rawText) {
  const lines = normalizeRawLines(rawLines, rawText);
  if (lines.length < 2) return false;
  if (looksLikeVideoChannelText(rawText, lines) || looksLikeBilibiliVideoText(rawText)) return false;
  if (looksLikeTextShareCardText(lines, rawText)) return true;
  if (lines.some((line) => looksLikeArticleMetadataLine(line))) return true;

  const footerCandidates = lines.slice(Math.max(0, lines.length - 2));
  return footerCandidates.some((line) => looksLikeArticleSourceFooter(line));
}

function inferSupportedShareCardType(rawLines, rawText, skipReason = null) {
  if (skipReason) return null;
  if (looksLikeTextShareCardText(rawLines, rawText)) return "text_share_card";
  if (looksLikeSingleArticleCardText(rawLines, rawText)) return "single_article_card";
  return null;
}

function looksLikePlainTextBlock(rawLines, rawText) {
  const lines = Array.isArray(rawLines) ? rawLines.filter(Boolean) : [];
  if (lines.length < 3) return false;
  if (looksLikeMarkdownDocText(rawText, rawLines) || looksLikeFileCardText(rawText)) return false;
  if (lines.some((line) => looksLikeUrlLikeText(line))) return false;
  if (lines.some((line) => looksLikeArticleMetadataLine(line))) return false;
  if (looksLikeSingleArticleCardText(rawLines, rawText)) return false;

  const text = String(rawText ?? "");
  const sentencePunctuationCount = (text.match(/[。！？；]/g) ?? []).length;
  const commaCount = (text.match(/[，,]/g) ?? []).length;
  const normalizedLength = normalizeComparableText(text).length;

  return normalizedLength >= 28 && (sentencePunctuationCount >= 2 || commaCount >= 3);
}

function looksLikeVideoChannelText(rawText, rawLines = []) {
  const text = String(rawText ?? "").normalize("NFKC");
  if (/视频号|video\s+channel|channels\.weixin\.qq\.com/i.test(text)) return true;

  const lines = Array.isArray(rawLines) ? rawLines.map((line) => String(line ?? "").trim()) : [];
  const hasExplicitFollow = lines.some(
    (line) =>
      /^\+?\s*\d*\s*个?朋友?关注$/.test(line) ||
      /^\+\s*关注$/.test(line) ||
      /^关注$/.test(line)
  );
  const hasVideoCue = /原声|时长|点赞|评论|转发|收藏|观看|播放|直播|封面|短视频|合集/i.test(text);
  const hasChannelCue = /视频号|video\s+channel/i.test(text);
  const socialCueMatches = text.match(/原声|时长|点赞|评论|转发|收藏|观看|播放|直播|封面|短视频|合集/g) ?? [];

  return hasChannelCue || (hasExplicitFollow && hasVideoCue) || socialCueMatches.length >= 2;
}

function classifyOcrShareCardSkipReason(rawText, rawLines = []) {
  if (looksLikeVideoChannelText(rawText, rawLines)) return "video_channel";
  if (looksLikeBilibiliVideoText(rawText)) return "bilibili_video";
  if (looksLikeMarkdownDocText(rawText, rawLines)) return "markdown_doc_card";
  if (looksLikeFileCardText(rawText)) return "file_card";
  if (looksLikeImageCardText(rawLines, rawText)) return "image_card";
  if (looksLikeWeakOcrShareCardText(rawLines, rawText)) return "weak_ocr_card";
  if (looksLikeSingleArticleCardText(rawLines, rawText)) return null;
  if (looksLikePlainTextBlock(rawLines, rawText)) return "plain_text_block";
  if (/共\s*\d+\s*篇|\b\d+\s+articles?\b|multiple\s+articles?/i.test(rawText)) {
    return "multi_article_card";
  }
  return null;
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
      const rawLines = Array.isArray(block?.rawLines)
        ? block.rawLines
        : String(block?.rawText ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
      const rawText = block?.rawText ?? rawLines.join("\n");
      const skipReason = block?.skipReason ?? null;

      return {
        ...block,
        blockId: block?.blockId ?? `block-${index}`,
        rawLines,
        rawText,
        directUrls: directUrlEntries
          .filter((entry) => entry.confidence === "confirmed")
          .map((entry) => entry.url),
        directUrlEntries,
        cardType: block?.cardType ?? inferSupportedShareCardType(rawLines, rawText, skipReason),
      };
    });
  }

  const items = Array.isArray(clipboardSnapshot.items) ? clipboardSnapshot.items : [];
  return items.map((item, index) => {
    const rawLines = String(item.rawText ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const rawText = item.rawText ?? "";
    const skipReason = item.skipReason ?? null;
    return {
      blockId: item.blockId ?? item.itemKey ?? `item-${index}`,
      timestampText: item.timestampText ?? null,
      rawLines,
      rawText,
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
      skipReason,
      cardType: item.cardType ?? inferSupportedShareCardType(rawLines, rawText, skipReason),
    };
  });
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
    const item = {
      kind: "share_card",
      itemKey: block.blockId,
      timestampText: block.timestampText,
      rawText: block.rawText,
      title: block.shareCardTitle,
      skipReason: block.skipReason ?? null,
    };
    if (block.cardType) {
      item.cardType = block.cardType;
    }
    return item;
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
    cardType:
      directUrlEntries.length > 0
        ? null
        : item.cardType ?? inferSupportedShareCardType(rawLines, rawText, item.skipReason ?? null),
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
  return nextChar === "/" || nextChar === "?" || nextChar === "&" || nextChar === "=";
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
    (hasBrand && hasVideoIndicator)
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

function normalizeOcrConfusableArticleSignature(normalizedText) {
  const value = String(normalizedText ?? "");
  if (!/[a-z0-9]/i.test(value)) return value;
  return value.replace(/[il1]/g, "i");
}

function addArticleFingerprintAlias(aliases, seen, alias) {
  const value = String(alias ?? "").trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  aliases.push(value);
}

function addArticleFingerprintFragmentAliases(aliases, seen, fragment, timestamp) {
  const normalized = String(fragment ?? "");
  if (normalized.length < 6) return;

  const addFragment = (value) => {
    if (!value || value.length < 6) return;
    addArticleFingerprintAlias(aliases, seen, [timestamp, value].filter(Boolean).join("|"));
    if (!timestamp) {
      addArticleFingerprintAlias(aliases, seen, value);
    }

    const confusable = normalizeOcrConfusableArticleSignature(value);
    if (confusable && confusable !== value) {
      addArticleFingerprintAlias(aliases, seen, [timestamp, confusable].filter(Boolean).join("|"));
      if (!timestamp) {
        addArticleFingerprintAlias(aliases, seen, confusable);
      }
    }
  };

  for (const length of [18, 16, 14, 10]) {
    addFragment(normalized.slice(0, length));
  }

  if (normalized.length >= 24) {
    for (let start = 8; start <= normalized.length - 10; start += 2) {
      addFragment(normalized.slice(start, start + 16));
      addFragment(normalized.slice(start, start + 14));
      addFragment(normalized.slice(start, start + 10));
    }
  }
}

function getBlockRawLines(block) {
  return Array.isArray(block?.rawLines)
    ? block.rawLines.map((line) => String(line ?? "").trim()).filter(Boolean)
    : String(block?.rawText ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function isTextShareBlock(block) {
  if (block?.cardType === "text_share_card") return true;
  return looksLikeTextShareCardText(getBlockRawLines(block), block?.rawText ?? block?.shareCardTitle ?? "");
}

function getArticleFingerprintLines(block) {
  const rawLines = getBlockRawLines(block);
  if (!isTextShareBlock(block)) return rawLines;

  return rawLines
    .map(stripTextShareHeader)
    .filter((line) => line && !/文字分享/.test(line) && !looksLikeArticleSourceFooter(line));
}

function buildArticleFingerprintAliases(block) {
  const timestamp = normalizeComparableText(block?.timestampText ?? "");
  const title = normalizeArticleSignatureLine(
    isTextShareBlock(block) ? stripTextShareHeader(block?.shareCardTitle ?? "") : block?.shareCardTitle ?? ""
  );
  const rawLines = getArticleFingerprintLines(block);
  const signatureLines = rawLines.map(normalizeArticleSignatureLine).filter(Boolean);
  const primary = title || signatureLines[0] || truncateComparableText(block?.rawText ?? "", 18);
  const secondary = signatureLines.find((line) => line !== primary) || "";
  const tertiary = signatureLines.find((line) => line !== primary && line !== secondary) || "";
  const aliases = [
    [timestamp, primary ? primary.slice(0, 18) : ""].filter(Boolean).join("|"),
    [timestamp, signatureLines[0] ? signatureLines[0].slice(0, 18) : ""].filter(Boolean).join("|"),
    [timestamp, primary ? primary.slice(0, 14) : "", secondary ? secondary.slice(0, 12) : ""]
      .filter(Boolean)
      .join("|"),
    [timestamp, primary ? primary.slice(0, 10) : ""].filter(Boolean).join("|"),
    [timestamp, primary ? primary.slice(0, 10) : "", secondary ? secondary.slice(0, 8) : ""]
      .filter(Boolean)
      .join("|"),
    [timestamp, primary ? primary.slice(0, 10) : "", tertiary ? tertiary.slice(0, 8) : ""]
      .filter(Boolean)
      .join("|"),
    signatureLines.length >= 2
      ? [primary ? primary.slice(0, 18) : "", secondary ? secondary.slice(0, 14) : ""]
          .filter(Boolean)
          .join("|")
      : "",
    signatureLines.length >= 3
      ? [primary ? primary.slice(0, 18) : "", tertiary ? tertiary.slice(0, 14) : ""]
          .filter(Boolean)
          .join("|")
      : "",
    signatureLines.length >= 2
      ? [signatureLines[0] ? signatureLines[0].slice(0, 16) : "", signatureLines[1] ? signatureLines[1].slice(0, 12) : ""]
          .filter(Boolean)
          .join("|")
      : "",
  ].filter(Boolean);

  const seen = new Set(aliases);
  for (const fragment of [primary, secondary, tertiary, ...signatureLines]) {
    addArticleFingerprintFragmentAliases(aliases, seen, fragment, timestamp);
  }

  return aliases;
}

function buildExtractionArticleFingerprintAliases(extraction, block) {
  const titleTexts = [
    extraction?.viewerH1LineText,
    extraction?.viewerTitleSource === "article_h1" ? extraction?.viewerTitleLineText : null,
  ]
    .map((text) => String(text ?? "").trim())
    .filter(Boolean);
  const aliases = [];
  const seen = new Set();

  for (const titleText of titleTexts) {
    for (const alias of buildArticleFingerprintAliases({
      timestampText: block?.timestampText ?? null,
      shareCardTitle: titleText,
      rawText: titleText,
      rawLines: [titleText],
      cardType: block?.cardType ?? "single_article_card",
    })) {
      addArticleFingerprintAlias(aliases, seen, alias);
    }
  }

  return aliases;
}

function mergeArticleFingerprintAliases(...groups) {
  const aliases = [];
  const seen = new Set();
  for (const group of groups) {
    for (const alias of group ?? []) {
      addArticleFingerprintAlias(aliases, seen, alias);
    }
  }
  return aliases;
}

function isOcrOnlyBlock(block) {
  return (
    (Array.isArray(block?.ocrCluster) && block.ocrCluster.length > 0) ||
    String(block?.blockId ?? "").startsWith("ocr-item-")
  );
}

function hasOcrCluster(block) {
  return Array.isArray(block?.ocrCluster) && block.ocrCluster.length > 0;
}

function buildArticleFingerprint(block) {
  return buildArticleFingerprintAliases(block)[0] ?? "";
}

function getBlockAnchorY(block) {
  const cluster = Array.isArray(block?.ocrCluster) ? block.ocrCluster : [];
  if (cluster.length > 0) {
    return Math.min(...cluster.map((line) => Number(line?.y ?? Number.POSITIVE_INFINITY)).filter(Number.isFinite));
  }
  return null;
}

function inferTimestampTextForBlock(blocks, index) {
  const block = blocks[index];
  if (!block || block.timestampText || !isOcrOnlyBlock(block)) return block?.timestampText ?? null;

  const blockY = getBlockAnchorY(block);
  let best = null;

  for (let candidateIndex = 0; candidateIndex < blocks.length; candidateIndex += 1) {
    if (candidateIndex === index) continue;
    const candidate = blocks[candidateIndex];
    if (!candidate?.timestampText) continue;

    const indexGap = Math.abs(candidateIndex - index);
    if (indexGap > OCR_TIMESTAMP_FALLBACK_MAX_INDEX_GAP) continue;

    const candidateY = getBlockAnchorY(candidate);
    const yGap =
      Number.isFinite(blockY) && Number.isFinite(candidateY) ? Math.abs(candidateY - blockY) : indexGap * 120;
    if (yGap > OCR_TIMESTAMP_FALLBACK_MAX_Y_GAP_PX) continue;

    const candidateLooksSupported = isSupportedActionableBlock(candidate);
    const blockLooksSupported = isSupportedActionableBlock(block);
    const supportPenalty = candidateLooksSupported === blockLooksSupported ? 0 : 250;
    const score = supportPenalty + indexGap * 1000 + yGap;
    if (!best || score < best.score) {
      best = { timestampText: candidate.timestampText, score };
    }
  }

  return best?.timestampText ?? null;
}

function applyOcrTimestampFallback(blocks) {
  return blocks.map((block, index) => {
    if (block?.timestampText || !isOcrOnlyBlock(block)) return block;
    const inferredTimestampText = inferTimestampTextForBlock(blocks, index);
    if (!inferredTimestampText) return block;
    return {
      ...block,
      timestampText: inferredTimestampText,
      inferredTimestampText,
    };
  });
}

function clampDateToRange(date, since, until) {
  if (date < since) return new Date(since);
  if (date > until) return new Date(until);
  return new Date(date);
}

function cstDayNumber(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.floor((date.getTime() + CST_OFFSET_MS) / DAY_MS);
}

function cstDayFallsWithinRange(date, since, until) {
  const day = cstDayNumber(date);
  const sinceDay = cstDayNumber(since);
  const untilDay = cstDayNumber(until);
  if (day === null || sinceDay === null || untilDay === null) return false;
  return day >= sinceDay && day <= untilDay;
}

function isSupportedShareCardBlock(block) {
  if (!block?.shareCardTitle || block?.skipReason) return false;
  if (SUPPORTED_SHARE_CARD_TYPES.has(block.cardType)) return true;
  return !hasOcrCluster(block);
}

function isSupportedActionableBlock(block) {
  if (!block) return false;
  if (getBlockDirectUrlEntries(block).length > 0) return true;
  return isSupportedShareCardBlock(block);
}

function classifyUnsupportedShareCardBlock(block) {
  if (!block?.shareCardTitle || getBlockDirectUrlEntries(block).length > 0) return null;
  if (block.skipReason) return null;
  if (isSupportedShareCardBlock(block)) return null;

  const rawLines = getBlockRawLines(block);
  const rawText = block.rawText ?? rawLines.join("\n");
  return classifyOcrShareCardSkipReason(rawText, rawLines) ?? "unsupported_ocr_card";
}

function blockMessageType(block) {
  if (block?.cardType === "text_share_card") return "text_share";
  if (block?.shareCardTitle) return "share_card";
  return "text_url";
}

function candidateMessageType(candidate, block) {
  if (candidate?.cardType === "text_share_card" || block?.cardType === "text_share_card") {
    return "text_share";
  }
  return "share_card";
}

function resolveOcrBlockMessageTime(
  block,
  { since, until, timestampReferenceNow, windowAssumptionNow } = {}
) {
  if (block?.timestampText) {
    const parsed = parseWeChatTimestamp(block.timestampText, timestampReferenceNow);
    if (parsed) {
      return {
        messageTime: parsed,
        timeConfidence: block.inferredTimestampText ? "group_inferred" : "explicit",
      };
    }
  }

  const canAssumeWindowTime =
    isOcrOnlyBlock(block) &&
    isSupportedActionableBlock(block) &&
    windowAssumptionNow instanceof Date &&
    !Number.isNaN(windowAssumptionNow.getTime()) &&
    cstDayFallsWithinRange(windowAssumptionNow, since, until);

  if (canAssumeWindowTime) {
    return {
      messageTime: clampDateToRange(windowAssumptionNow, since, until),
      timeConfidence: "window_assumed",
    };
  }

  return { messageTime: null, timeConfidence: null };
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
    attemptCount: 0,
    lastFailureReason: null,
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

function isRetryableExtractionFailureReason(reason) {
  return RETRYABLE_EXTRACTION_REASONS.has(String(reason ?? ""));
}

function isSoftOcrSkipReason(reason) {
  return SOFT_OCR_SKIP_REASONS.has(String(reason ?? ""));
}

function canRetryArticleState(state) {
  return (
    state?.status === "failed" &&
    isRetryableExtractionFailureReason(state.lastFailureReason) &&
    Number(state.attemptCount ?? 0) < ARTICLE_RETRY_LIMIT
  );
}

function duplicateSkipReasonForArticleState(state) {
  if (state?.status === "resolved") return "article_already_resolved";
  if (state?.status === "skipped") return "article_already_skipped";
  if (state?.status === "pending") return "article_already_pending";
  if (state?.status === "failed" && isRetryableExtractionFailureReason(state.lastFailureReason)) {
    return "article_retry_limit_reached";
  }
  return "article_already_attempted";
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
    cardType: block.cardType ?? null,
    ocrText: block.ocrCluster?.[0]?.text ?? block.shareCardTitle ?? "",
    lineIndex: null,
    clickX: clickPoint.x,
    clickY: clickPoint.y,
    line: { ...rect, text: block.ocrCluster?.[0]?.text ?? block.shareCardTitle ?? "" },
    matchReason: "cluster_fallback",
  };
}

function isCandidateClickInsideRightChatPane(candidate, windowBounds) {
  if (!candidate || !windowBounds) return true;
  const clickX = Number(candidate.clickX);
  const clickY = Number(candidate.clickY);
  const windowX = Number(windowBounds.x ?? 0);
  const windowY = Number(windowBounds.y ?? 0);
  const windowWidth = Number(windowBounds.width ?? 0);
  const windowHeight = Number(windowBounds.height ?? 0);
  if (![clickX, clickY, windowX, windowY, windowWidth, windowHeight].every(Number.isFinite)) return false;
  if (windowWidth <= 0 || windowHeight <= 0) return false;

  const minX = windowX + windowWidth * OCR_RIGHT_PANE_RATIO;
  const maxX = windowX + windowWidth;
  const minY = windowY + windowHeight * OCR_TOP_CONTENT_RATIO;
  const maxY = windowY + windowHeight * 0.98;
  return clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY;
}

function candidateClickSafetyStatus(candidate, windowBounds) {
  if (!candidate) return "missing_candidate";
  return isCandidateClickInsideRightChatPane(candidate, windowBounds)
    ? "inside_right_chat_pane"
    : "outside_right_chat_pane";
}

function finiteNumberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function serializeWindowBounds(windowBounds) {
  if (!windowBounds) return null;
  return {
    x: finiteNumberOrNull(windowBounds.x),
    y: finiteNumberOrNull(windowBounds.y),
    width: finiteNumberOrNull(windowBounds.width),
    height: finiteNumberOrNull(windowBounds.height),
  };
}

function serializeCandidateOcrRect(line) {
  if (!line) return null;
  return {
    x: finiteNumberOrNull(line.x),
    y: finiteNumberOrNull(line.y),
    width: finiteNumberOrNull(line.width),
    height: finiteNumberOrNull(line.height),
    text: line.text ?? null,
  };
}

function annotateCandidateArtifact(artifactRecord, candidate, windowBounds) {
  if (!artifactRecord) return;
  artifactRecord.click_safety_status = candidateClickSafetyStatus(candidate, windowBounds);
  artifactRecord.match_reason = candidate?.matchReason ?? null;
  artifactRecord.screen_click_point = candidate
    ? {
        x: finiteNumberOrNull(candidate.clickX),
        y: finiteNumberOrNull(candidate.clickY),
      }
    : null;
  artifactRecord.window_bounds = serializeWindowBounds(windowBounds);
  artifactRecord.candidate_ocr_rect = serializeCandidateOcrRect(candidate?.line);
}

function hasCandidateForActionableShareCards(blocks, candidateMap) {
  const actionableBlocks = blocks.filter(
    (block) => isSupportedShareCardBlock(block) && getBlockDirectUrlEntries(block).length === 0
  );
  if (actionableBlocks.length === 0) return true;
  return actionableBlocks.some((block) => candidateMap.has(block.blockId));
}

function classifyViewerContentSkipReason(ocrResult, ocrAnalysis = null) {
  if (ocrAnalysis?.matched || ocrAnalysis?.articleShellLoaded) return null;
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const text = lines.map((line) => String(line?.text ?? "").trim()).filter(Boolean).join("\n");
  if (!text) return null;
  if (/微信公众平台|mp\.weixin\.qq\.com/i.test(text)) return null;
  if (looksLikeVideoChannelText(text, lines.map((line) => line?.text ?? ""))) return "video_channel";
  if (looksLikeBilibiliVideoText(text)) return "bilibili_video";
  return null;
}

function lineBelongsToOcrRect(line, rect) {
  const lineLeft = Number(line?.x ?? NaN);
  const lineTop = Number(line?.y ?? NaN);
  const lineWidth = Number(line?.width ?? 0);
  const lineHeight = Number(line?.height ?? 0);
  const lineRight = lineLeft + lineWidth;
  const lineBottom = lineTop + lineHeight;
  if (
    !Number.isFinite(lineLeft) ||
    !Number.isFinite(lineTop) ||
    !Number.isFinite(lineRight) ||
    !Number.isFinite(lineBottom) ||
    lineWidth <= 0 ||
    lineHeight <= 0
  ) {
    return false;
  }

  const centerX = lineLeft + lineWidth / 2;
  const centerY = lineTop + lineHeight / 2;
  if (centerX >= rect.x && centerX <= rect.x + rect.width && centerY >= rect.y && centerY <= rect.y + rect.height) {
    return true;
  }

  const intersectLeft = Math.max(lineLeft, rect.x);
  const intersectRight = Math.min(lineRight, rect.x + rect.width);
  const intersectTop = Math.max(lineTop, rect.y);
  const intersectBottom = Math.min(lineBottom, rect.y + rect.height);
  const intersectWidth = Math.max(0, intersectRight - intersectLeft);
  const intersectHeight = Math.max(0, intersectBottom - intersectTop);
  const overlapRatio = (intersectWidth * intersectHeight) / (lineWidth * lineHeight);
  return overlapRatio >= 0.6;
}

function buildOcrRectFromScreenRect(screenRect, screenBounds, ocrResult, paddingPx = 0) {
  const imageWidth = Number(ocrResult?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? 0);
  const boundsWidth = Number(screenBounds?.width ?? 0);
  const boundsHeight = Number(screenBounds?.height ?? 0);
  if (!screenRect || !screenBounds || imageWidth <= 0 || imageHeight <= 0 || boundsWidth <= 0 || boundsHeight <= 0) {
    return null;
  }

  const scaleX = imageWidth / boundsWidth;
  const scaleY = imageHeight / boundsHeight;
  const x = (Number(screenRect.x ?? 0) - Number(screenBounds.x ?? 0)) * scaleX - paddingPx;
  const y = (Number(screenRect.y ?? 0) - Number(screenBounds.y ?? 0)) * scaleY - paddingPx;
  const width = Number(screenRect.width ?? 0) * scaleX + paddingPx * 2;
  const height = Number(screenRect.height ?? 0) * scaleY + paddingPx * 2;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(imageWidth, x + width) - Math.max(0, x),
    height: Math.min(imageHeight, y + height) - Math.max(0, y),
  };
}

function axisOverlap(start, size, candidateStart, candidateSize) {
  const left = Math.max(start, candidateStart);
  const right = Math.min(start + size, candidateStart + candidateSize);
  return Math.max(0, right - left);
}

function chooseInferredScreenOrigin(axisStart, axisSize, boundsStart, boundsSize, inferredSize) {
  const candidates = [
    boundsStart,
    0,
    axisStart,
    axisStart + axisSize - inferredSize,
    boundsStart + boundsSize - inferredSize,
  ].filter((value) => Number.isFinite(value));
  let best = null;

  for (const candidate of candidates) {
    const overlap = axisOverlap(axisStart, axisSize, candidate, inferredSize);
    const containsCenter =
      axisStart + axisSize / 2 >= candidate && axisStart + axisSize / 2 <= candidate + inferredSize;
    const score = overlap + (containsCenter ? inferredSize : 0) - Math.abs(candidate) / 10000;
    if (!best || score > best.score) {
      best = { value: candidate, score };
    }
  }

  return best?.value ?? boundsStart;
}

function normalizeScreenBoundsForOcr(screenBounds, screenRect, ocrResult) {
  const imageWidth = Number(ocrResult?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? 0);
  const boundsX = Number(screenBounds?.x ?? 0);
  const boundsY = Number(screenBounds?.y ?? 0);
  const boundsWidth = Number(screenBounds?.width ?? 0);
  const boundsHeight = Number(screenBounds?.height ?? 0);
  const rectX = Number(screenRect?.x ?? boundsX);
  const rectY = Number(screenRect?.y ?? boundsY);
  const rectWidth = Number(screenRect?.width ?? 0);
  const rectHeight = Number(screenRect?.height ?? 0);

  if (
    !screenBounds ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    boundsWidth <= 0 ||
    boundsHeight <= 0 ||
    ![boundsX, boundsY, rectX, rectY, rectWidth, rectHeight].every(Number.isFinite)
  ) {
    return screenBounds;
  }

  const scaleX = imageWidth / boundsWidth;
  const scaleY = imageHeight / boundsHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return screenBounds;
  }

  const scaleRatio = scaleX / scaleY;
  if (scaleRatio >= 0.85 && scaleRatio <= 1.15) {
    return screenBounds;
  }

  const inferredWidth = imageWidth / scaleY;
  if (!Number.isFinite(inferredWidth) || inferredWidth <= 0 || Math.abs(inferredWidth - boundsWidth) < 1) {
    return screenBounds;
  }

  return {
    ...screenBounds,
    x: chooseInferredScreenOrigin(rectX, rectWidth, boundsX, boundsWidth, inferredWidth),
    y: boundsY,
    width: inferredWidth,
    height: boundsHeight,
  };
}

function filterOcrResultToScreenRect(ocrResult, screenRect, screenBounds, { paddingPx = 20 } = {}) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const effectiveScreenBounds = normalizeScreenBoundsForOcr(screenBounds, screenRect, ocrResult);
  const ocrRect = buildOcrRectFromScreenRect(screenRect, effectiveScreenBounds, ocrResult, paddingPx);
  if (!ocrRect) return ocrResult;
  return {
    ...ocrResult,
    lines: lines.filter((line) => lineBelongsToOcrRect(line, ocrRect)),
  };
}

function countMeaningfulOcrLines(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  return lines.filter((line) => normalizeComparableText(line?.text ?? "").length >= 4).length;
}

function buildViewerOcrContext(ocrResult, screenRect, screenBounds, candidate) {
  const effectiveScreenBounds = normalizeScreenBoundsForOcr(screenBounds, screenRect, ocrResult);
  const viewerOcrResult = filterOcrResultToScreenRect(ocrResult, screenRect, effectiveScreenBounds);
  return {
    screenBounds: effectiveScreenBounds,
    viewerOcrResult,
    ocrAnalysis: analyzeViewerOcr(viewerOcrResult, candidate),
  };
}

export function buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds }) {
  const ocrLines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const titleLine = findFileHelperTitleLine(ocrLines, ocrResult?.height ?? windowBounds?.height ?? 0);
  const blocks = normalizeSnapshotBlocks(clipboardSnapshot);
  const clipboardHasShareCards = blocks.some((block) => Boolean(block.shareCardTitle));
  const ocrFallbackBlocks = clipboardHasShareCards
    ? []
    : inferShareCardItemsFromOcr(ocrLines, {
        imageWidth: ocrResult?.width ?? windowBounds?.width ?? 0,
        imageHeight: ocrResult?.height ?? windowBounds?.height ?? 0,
      })
        .map(ocrFallbackItemToBlock)
        .filter((block) => !shouldFilterOcrFallbackBlock(block, blocks));
  const effectiveBlocks = clipboardHasShareCards ? blocks : [...blocks, ...ocrFallbackBlocks];
  const effectiveItems = effectiveBlocks.map(blockToSnapshotItem).filter(Boolean);
  const shareCardBlocks = effectiveBlocks.filter(
    (block) => isSupportedShareCardBlock(block) && getBlockDirectUrlEntries(block).length === 0
  );
  const candidates = [];
  const usedLineIndexes = new Set();
  let lastMatchedY = -1;

  for (const block of shareCardBlocks) {
    if (Array.isArray(block.ocrCluster) && block.ocrCluster.length > 0) {
      const fallbackCandidate = buildFallbackCandidateFromCluster(block, windowBounds, ocrResult);
      if (fallbackCandidate) {
        candidates.push(fallbackCandidate);
        continue;
      }
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
      imageWidth: ocrResult?.width ?? windowBounds?.width ?? 0,
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
      cardType: block.cardType ?? null,
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

function findBestShareCardLine({ item, ocrLines, usedLineIndexes, lastMatchedY, imageHeight, imageWidth = 0 }) {
  const titleNorm = normalizeComparableText(item.title || item.rawText);
  const topBoundary = imageHeight > 0 ? imageHeight * 0.16 : 0;
  const bottomBoundary = imageHeight > 0 ? imageHeight * 0.95 : Number.POSITIVE_INFINITY;
  const minX = imageWidth > 0 ? imageWidth * OCR_RIGHT_PANE_RATIO : 0;

  let best = null;
  for (let index = 0; index < ocrLines.length; index++) {
    if (usedLineIndexes.has(index)) continue;
    const line = ocrLines[index];
    if (!line?.text) continue;
    if (line.y < topBoundary || line.y > bottomBoundary) continue;
    if (line.x < minX) continue;

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
    getFrontWeChatWindowFn = getFrontWeChatWindow,
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
    nowFn = () => new Date(),
  } = {}
) {
  const sessionId = newCaptureSessionId();
  const capturedAt = nowFn();
  const referenceNow = until instanceof Date ? until : capturedAt;
  const stats = {
    source: "ui",
    share_cards_seen: 0,
    share_cards_attempted: 0,
    share_cards_resolved: 0,
    share_cards_unresolved: 0,
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
  };

  const records = [];
  const uncertainRecords = [];
  const pendingRecords = [];
  const skippedRecords = [];
  const seenUrls = new Set();
  const seenUncertainUrls = new Set();
  const seenKeys = new Set();
  const seenSkippedKeys = new Set();
  const seenPendingKeys = new Set();
  const articleStates = new Map();
  const seenPages = new Set();
  const artifactDir = runDir ? path.join(runDir, "artifacts") : null;
  const candidateArtifacts = [];

  async function persistCandidateArtifacts() {
    if (!artifactDir) return;
    await writeJsonArtifact(path.join(artifactDir, "candidates.json"), candidateArtifacts);
  }

  async function pushCandidateArtifact(record) {
    if (!record) return;
    candidateArtifacts.push(record);
    await persistCandidateArtifacts();
  }

  function pushSkippedRecord({ messageTime, title = "", rawText = "", skipReason, rawUrl = "" }) {
    if (!skipReason) return;

    const messageTimeIso = (messageTime ?? referenceNow).toISOString();
    const dedupeBasis = rawUrl || title || truncateComparableText(rawText, 40) || skipReason;
    const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, `skip:${skipReason}:${dedupeBasis}`);
    if (seenSkippedKeys.has(key)) return;
    seenSkippedKeys.add(key);

    skippedRecords.push({
      captured_at: capturedAt.toISOString(),
      message_time: messageTimeIso,
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

  function pushPendingRecord({ title = "", rawText = "", pendingReason, articleFingerprint = "" }) {
    if (!pendingReason) return;

    const dedupeBasis = articleFingerprint || title || truncateComparableText(rawText, 40) || pendingReason;
    const key = dedupeKey(
      FILE_HELPER_CHAT_NAME,
      `${since.toISOString()}|${until.toISOString()}`,
      `pending:${pendingReason}:${dedupeBasis}`
    );
    if (seenPendingKeys.has(key)) return;
    seenPendingKeys.add(key);

    pendingRecords.push({
      captured_at: capturedAt.toISOString(),
      message_time: null,
      chat_name: FILE_HELPER_CHAT_NAME,
      record_type: "pending_item",
      title: title || "(untitled pending item)",
      raw_text: rawText || "",
      pending_reason: pendingReason,
      dedupe_key: key,
      capture_session_id: sessionId,
      source: "ui",
      pending_window_since: since.toISOString(),
      pending_window_until: until.toISOString(),
    });
  }

  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
  }

  await waitForUserReadyFn();
  await navigateToFileHelperFn(debug);

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

    const pageBlocks = applyOcrTimestampFallback(normalizeSnapshotBlocks(page.clipboardSnapshot));
    if (page.samplingMode === "ocr_plus_clipboard") {
      stats.clipboard_reads += 1;
    } else if (page.samplingMode === "ocr_only") {
      stats.ocr_only_pages += 1;
    }

    const pageSignature = pageBlocks.map((block) => buildBlockSignature(block)).join(";");
    if (seenPages.has(pageSignature)) {
      consecutiveDuplicatePages += 1;
      if (consecutiveDuplicatePages >= 2) break;
    } else {
      seenPages.add(pageSignature);
      consecutiveDuplicatePages = 0;
    }
    lastUrlLikeSignature = page.urlLikeSignature ?? null;
    const pageHasCandidateGenerationFailure = !hasCandidateForActionableShareCards(pageBlocks, page.candidateMap);

    stats.share_cards_seen += pageBlocks.filter((block) => Boolean(block.shareCardTitle)).length;
    for (const [reason, count] of Object.entries(page.clipboardSnapshot.stats.skipped_by_rule)) {
      incrementCount(stats.skipped_by_rule, reason, count);
    }

    let reachedBeforeRange = false;
    for (const block of pageBlocks) {
      const { messageTime, timeConfidence } = resolveOcrBlockMessageTime(block, {
        since,
        until,
        timestampReferenceNow: referenceNow,
        windowAssumptionNow: capturedAt,
      });

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
              card_type: block.cardType ?? null,
              page_index: scrollCount,
              click_x: null,
              click_y: null,
              status: "pending",
              article_fingerprint: articleFingerprint || null,
              sampling_mode: page.samplingMode ?? null,
              time_confidence: timeConfidence,
            }
          : null;

      if (directRecords.length > 0 || uncertainDirectRecords.length > 0) {
        if (!messageTime && isOcrOnlyBlock(block)) {
          pushPendingRecord({
            title: block.shareCardTitle ?? directRecords[0] ?? uncertainDirectRecords[0]?.url ?? "",
            rawText: block.rawText,
            pendingReason: "missing_timestamp",
            articleFingerprint: articleFingerprint || directRecords[0] || uncertainDirectRecords[0]?.url || "",
          });
          if (artifactRecord) {
            artifactRecord.status = "pending";
            artifactRecord.reason = "missing_timestamp";
            artifactRecord.url = directRecords[0] ?? uncertainDirectRecords[0]?.url ?? null;
            await pushCandidateArtifact(artifactRecord);
          }
          if (articleFingerprints.length > 0) {
            upsertArticleState(articleStates, articleFingerprints, {
              status: "pending",
              attempted: false,
              resolved: false,
              failed: false,
              skipped: false,
              lastSeenPage: scrollCount,
              lastSeenYBand: null,
            });
          }
          stats.uncertain_links_total += uncertainDirectRecords.length;
          continue;
        }

        for (const skippedEntry of directSkippedEntries) {
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? skippedEntry.url,
            rawText: block.rawText,
            skipReason: skippedEntry.reason,
            rawUrl: skippedEntry.url,
          });
        }

        const messageTimeIso = (messageTime ?? referenceNow).toISOString();
        for (const canonicalUrl of directRecords) {
          if (seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);

          const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "link",
            message_type: blockMessageType(block),
            title: block.shareCardTitle ?? "",
            url: canonicalUrl,
            time_confidence: timeConfidence,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
        }

        for (const uncertainEntry of uncertainDirectRecords) {
          if (seenUrls.has(uncertainEntry.url) || seenUncertainUrls.has(uncertainEntry.url)) continue;
          seenUncertainUrls.add(uncertainEntry.url);

          const key = dedupeKey(
            FILE_HELPER_CHAT_NAME,
            messageTimeIso,
            `uncertain:${uncertainEntry.url}:${uncertainEntry.confidenceReason}`
          );
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          uncertainRecords.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "uncertain_link",
            message_type: blockMessageType(block),
            title: block.shareCardTitle ?? "",
            url: uncertainEntry.url,
            confidence_reason: uncertainEntry.confidenceReason,
            time_confidence: timeConfidence,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
        }

        if (artifactRecord) {
          artifactRecord.status = directRecords.length > 0 ? "resolved_direct_url" : "uncertain_direct_url";
          artifactRecord.url = directRecords[0] ?? uncertainDirectRecords[0]?.url ?? null;
          artifactRecord.reason = uncertainDirectRecords[0]?.confidenceReason ?? null;
          await pushCandidateArtifact(artifactRecord);
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
          await pushCandidateArtifact(artifactRecord);
        }
        for (const skippedEntry of directSkippedEntries) {
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

      const unsupportedSkipReason = classifyUnsupportedShareCardBlock(block);
      if (unsupportedSkipReason) {
        const softUnsupportedSkip = isSoftOcrSkipReason(unsupportedSkipReason);
        if (artifactRecord) {
          if (
            existingArticleState &&
            (!softUnsupportedSkip || existingArticleState.resolved || existingArticleState.skipped)
          ) {
            artifactRecord.status = "duplicate_skipped";
            artifactRecord.reason = "article_already_skipped";
            stats.duplicate_skipped += 1;
            await pushCandidateArtifact(artifactRecord);
            upsertArticleState(articleStates, articleFingerprints, {
              lastSeenPage: scrollCount,
              lastSeenYBand: existingArticleState.lastSeenYBand ?? null,
            });
            continue;
          }

          artifactRecord.status = "skipped";
          artifactRecord.reason = unsupportedSkipReason;
          await pushCandidateArtifact(artifactRecord);
        }
        incrementCount(stats.skipped_by_rule, unsupportedSkipReason);
        pushSkippedRecord({
          messageTime,
          title: block.shareCardTitle ?? "",
          rawText: block.rawText,
          skipReason: unsupportedSkipReason,
        });
        if (!softUnsupportedSkip) {
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

      if (!block.shareCardTitle || block.skipReason) {
        if (artifactRecord && block.skipReason) {
          const softBlockSkip = isSoftOcrSkipReason(block.skipReason);
          if (existingArticleState && (!softBlockSkip || existingArticleState.resolved || existingArticleState.skipped)) {
            artifactRecord.status = "duplicate_skipped";
            artifactRecord.reason = "article_already_skipped";
            stats.duplicate_skipped += 1;
            await pushCandidateArtifact(artifactRecord);
            upsertArticleState(articleStates, articleFingerprints, {
              lastSeenPage: scrollCount,
              lastSeenYBand: existingArticleState.lastSeenYBand ?? null,
            });
            continue;
          }
          artifactRecord.status = "skipped";
          artifactRecord.reason = block.skipReason;
          await pushCandidateArtifact(artifactRecord);
          pushSkippedRecord({
            messageTime,
            title: block.shareCardTitle ?? "",
            rawText: block.rawText,
            skipReason: block.skipReason,
          });
          if (!softBlockSkip) {
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
        }
        continue;
      }

      if (!messageTime && isOcrOnlyBlock(block)) {
        if (existingArticleState) {
          if (artifactRecord) {
            artifactRecord.status = "duplicate_skipped";
            artifactRecord.reason = "article_already_pending";
            await pushCandidateArtifact(artifactRecord);
          }
          stats.duplicate_skipped += 1;
          upsertArticleState(articleStates, articleFingerprints, {
            lastSeenPage: scrollCount,
            lastSeenYBand: existingArticleState.lastSeenYBand ?? null,
          });
          continue;
        }

        if (artifactRecord) {
          artifactRecord.status = "pending";
          artifactRecord.reason = "missing_timestamp";
          await pushCandidateArtifact(artifactRecord);
        }
        pushPendingRecord({
          title: block.shareCardTitle ?? "",
          rawText: block.rawText,
          pendingReason: "missing_timestamp",
          articleFingerprint,
        });
        upsertArticleState(articleStates, articleFingerprints, {
          status: "pending",
          attempted: false,
          resolved: false,
          failed: false,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: null,
        });
        continue;
      }

      if (existingArticleState && !canRetryArticleState(existingArticleState)) {
        if (artifactRecord) {
          artifactRecord.status = "duplicate_skipped";
          artifactRecord.reason = duplicateSkipReasonForArticleState(existingArticleState);
          await pushCandidateArtifact(artifactRecord);
        }
        stats.duplicate_skipped += 1;
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
        annotateCandidateArtifact(artifactRecord, candidate, page.window);
        await pushCandidateArtifact(artifactRecord);
      }

      if (!candidate) {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = pageHasCandidateGenerationFailure
          ? "candidate_generation_failed"
          : "ocr_candidate_missing";
        stats.share_cards_unresolved += 1;
        await persistCandidateArtifacts();
        continue;
      }

      if (candidateClickSafetyStatus(candidate, page.window) !== "inside_right_chat_pane") {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = "candidate_click_outside_chat_pane";
        stats.share_cards_unresolved += 1;
        upsertArticleState(articleStates, articleFingerprints, {
          status: "failed",
          attempted: false,
          resolved: false,
          failed: true,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: null,
        });
        await persistCandidateArtifacts();
        continue;
      }

      const candidateYBand = buildCandidateYBand(candidate);
      const nextAttemptCount = Number(existingArticleState?.attemptCount ?? 0) + 1;
      upsertArticleState(articleStates, articleFingerprints, {
        status: "attempted",
        attemptCount: nextAttemptCount,
        lastFailureReason: null,
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
      const extraction = await extractShareCardUrlFn(candidate, {
        debug,
        artifactDir,
      }, {
        recoverChatFn: navigateToFileHelperFn,
      });
      stats.viewer_open_wait_ms_total += extraction.timings?.viewer_open_wait_ms ?? 0;
      stats.viewer_ready_wait_ms_total += extraction.timings?.viewer_ready_wait_ms ?? 0;
      stats.viewer_menu_wait_ms_total += extraction.timings?.viewer_menu_wait_ms ?? 0;
      stats.viewer_copy_wait_ms_total += extraction.timings?.viewer_copy_wait_ms ?? 0;
      stats.viewer_close_wait_ms_total += extraction.timings?.viewer_close_wait_ms ?? 0;
      attachCopyDiagnostics(artifactRecord, extraction);

      if (extraction.status === "skipped" && extraction.reason) {
        incrementCount(stats.skipped_by_rule, extraction.reason);
        artifactRecord.status = "skipped";
        artifactRecord.reason = extraction.reason;
        pushSkippedRecord({
          messageTime,
          title: candidate.title ?? block.shareCardTitle ?? "",
          rawText: block.rawText,
          skipReason: extraction.reason,
        });
        upsertArticleState(articleStates, articleFingerprints, {
          status: "skipped",
          attemptCount: nextAttemptCount,
          lastFailureReason: null,
          attempted: true,
          resolved: false,
          failed: false,
          skipped: true,
          lastSeenPage: scrollCount,
          lastSeenYBand: candidateYBand,
        });
      } else if (extraction.status === "ok" && extraction.url) {
        const canonicalUrl = canonicalizeUrl(extraction.url);
        const skipReason = classifySkipReason(canonicalUrl);
        const resolvedArticleFingerprints = mergeArticleFingerprintAliases(
          articleFingerprints,
          buildExtractionArticleFingerprintAliases(extraction, block)
        );
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
          upsertArticleState(articleStates, resolvedArticleFingerprints, {
            status: "skipped",
            attemptCount: nextAttemptCount,
            lastFailureReason: null,
            attempted: true,
            resolved: false,
            failed: false,
            skipped: true,
            lastSeenPage: scrollCount,
            lastSeenYBand: candidateYBand,
          });
          await persistCandidateArtifacts();
          continue;
        }

        const messageTimeIso = (messageTime ?? referenceNow).toISOString();
        const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          seenUrls.add(canonicalUrl);
          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            chat_name: FILE_HELPER_CHAT_NAME,
            record_type: "link",
            message_type: candidateMessageType(candidate, block),
            title: candidate.title ?? block.shareCardTitle ?? "",
            url: canonicalUrl,
            time_confidence: timeConfidence,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
        }

        artifactRecord.status = "resolved";
        artifactRecord.url = canonicalUrl;
        artifactRecord.used_browser_fallback = Boolean(extraction.usedBrowserFallback);
        stats.share_cards_resolved += 1;
        upsertArticleState(articleStates, resolvedArticleFingerprints, {
          status: "resolved",
          attemptCount: nextAttemptCount,
          lastFailureReason: null,
          attempted: true,
          resolved: true,
          failed: false,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: candidateYBand,
        });
        if (extraction.usedBrowserFallback) {
          stats.browser_fallback_used += 1;
        }
      } else {
        const failureReason = extraction.reason ?? "share_card_extractor_failed";
        artifactRecord.status = "unresolved";
        artifactRecord.reason = failureReason;
        stats.share_cards_unresolved += 1;
        upsertArticleState(articleStates, articleFingerprints, {
          status: "failed",
          attemptCount: nextAttemptCount,
          lastFailureReason: failureReason,
          attempted: true,
          resolved: false,
          failed: true,
          skipped: false,
          lastSeenPage: scrollCount,
          lastSeenYBand: candidateYBand,
        });
      }

      await persistCandidateArtifacts();

      if (stats.share_cards_attempted >= maxCandidates) {
        limitReached = true;
        if (debug) {
          console.log(`[debug] Reached max candidate limit (${maxCandidates}), stopping early.`);
        }
        break;
      }
    }

    if (reachedBeforeRange) break;
    if (limitReached) break;
    if (pageHasCandidateGenerationFailure) {
      if (debug) {
        console.log("[debug] Failed to generate clickable candidates for actionable blocks; stopping early.");
      }
      break;
    }

    scrollCount += 1;
    if (scrollCount <= maxScrolls) {
      scrollPageFn(debug);
    }
  }

  await persistCandidateArtifacts();

  console.log(`Scrolled ${scrollCount} time(s), found ${records.length} unique link(s).`);
  return { records, uncertainRecords, pendingRecords, skippedRecords, stats };
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
    getFrontWeChatWindowFn = getFrontWeChatWindow,
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
  const effectiveBlocks = applyOcrTimestampFallback(uiSnapshot.effectiveBlocks);
  const mergedClipboardSnapshot = {
    ...clipboardSnapshot,
    blocks: effectiveBlocks,
    items: effectiveBlocks.map(blockToSnapshotItem).filter(Boolean),
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

async function openViewerMenu(
  viewerContext,
  { debug = false, artifactDir = null } = {},
  {
    clickAtPointFn = clickAtPoint,
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureFullScreenScreenshotFn = captureFullScreenScreenshot,
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
    const screenBounds = captureFullScreenScreenshotFn(screenshotPath, probeRect);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const menuScreenBounds = normalizeScreenBoundsForOcr(screenBounds, probeRect, ocrResult);
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
      return { copyLine, browserLine, ocrResult, screenBounds: menuScreenBounds };
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
  const screenBounds = viewerContext?.screenBounds ?? probeRect;
  const ocrResult = viewerContext?.ocrResult ?? null;
  const ocrLines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const anchorLine = findMenuActionLine(ocrLines, VIEWER_MENU_ANCHOR_LABELS);

  if (probeRect && screenBounds && anchorLine && Number(ocrResult?.width) > 0 && Number(ocrResult?.height) > 0) {
    const scaleX = screenBounds.width / ocrResult.width;
    const scaleY = screenBounds.height / ocrResult.height;
    const anchorRight = screenBounds.x + (anchorLine.x + anchorLine.width) * scaleX;
    const anchorCenterY = screenBounds.y + (anchorLine.y + anchorLine.height / 2) * scaleY;
    const primaryX = anchorRight + 30;
    const probeCandidates = [
      { x: primaryX, y: anchorCenterY },
      { x: primaryX, y: anchorCenterY },
      { x: anchorRight + 18, y: anchorCenterY },
      { x: primaryX, y: anchorCenterY - 8 },
      { x: primaryX, y: anchorCenterY + 8 },
    ];

    return probeCandidates.map((point) => clampProbePoint(point, probeRect));
  }

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

function extractHttpUrlFromText(text) {
  const value = String(text ?? "").trim();
  const match = value.match(/https?:\/\/[^\s<>"'`）】\]]+/i);
  if (!match) return null;
  try {
    return new URL(match[0].replace(/[.,;:!?)\]>'"。，；：！？）】]+$/, "")).toString();
  } catch {
    return null;
  }
}

function classifyCopiedUrlKind(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.host.toLowerCase() === "mp.weixin.qq.com") return "mp_weixin";
    return "external_url";
  } catch {
    return null;
  }
}

function getUrlHost(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function waitForClipboardShareUrl(
  { timeoutMs = 1500, pollMs = 25 } = {},
  { readClipboardTextFn = readClipboardText, sleepMsFn = sleepMs } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastClipboardText = "";
  while (Date.now() < deadline) {
    attempts += 1;
    const clipboard = readClipboardTextFn();
    lastClipboardText = clipboard ?? "";
    const copiedUrl = extractHttpUrlFromText(clipboard);
    if (copiedUrl) {
      return { url: copiedUrl, attempts, lastClipboardText };
    }
    sleepMsFn(pollMs);
  }
  return { url: null, attempts, lastClipboardText };
}

function summarizeClipboardText(text) {
  const value = String(text ?? "").trim();
  if (!value) return "empty";
  if (/^(empty|non_url_text|url_host:)/.test(value)) return value;

  try {
    const parsed = new URL(value);
    return `url_host:${parsed.host.toLowerCase()}`;
  } catch {
    return "non_url_text";
  }
}

function attachCopyDiagnostics(artifactRecord, extraction) {
  if (!artifactRecord || !extraction) return;
  if (Number.isFinite(extraction.copyAttempts)) {
    artifactRecord.copy_attempts = extraction.copyAttempts;
  }
  if (extraction.copyFailureReason) {
    artifactRecord.copy_failure_reason = extraction.copyFailureReason;
  }
  if (Object.hasOwn(extraction, "copyLastClipboardText")) {
    artifactRecord.copy_last_clipboard = summarizeClipboardText(extraction.copyLastClipboardText);
  }
  if (Object.hasOwn(extraction, "copyUrlKind")) {
    artifactRecord.copy_url_kind = extraction.copyUrlKind;
  }
  if (Object.hasOwn(extraction, "copiedUrlHost")) {
    artifactRecord.copied_url_host = extraction.copiedUrlHost;
  }
  if (Object.hasOwn(extraction, "viewerReadyState")) {
    artifactRecord.viewer_ready_state = extraction.viewerReadyState;
  }
  if (Object.hasOwn(extraction, "viewerTitleLineText")) {
    artifactRecord.viewer_title_line_text = extraction.viewerTitleLineText;
  }
  if (Object.hasOwn(extraction, "viewerTitleMatched")) {
    artifactRecord.viewer_title_matched = extraction.viewerTitleMatched;
  }
  if (Object.hasOwn(extraction, "viewerTitleSource")) {
    artifactRecord.viewer_title_source = extraction.viewerTitleSource;
  }
  if (Object.hasOwn(extraction, "viewerH1LineText")) {
    artifactRecord.viewer_h1_line_text = extraction.viewerH1LineText;
  }
  if (Object.hasOwn(extraction, "viewerChromeTitleLineText")) {
    artifactRecord.viewer_chrome_title_line_text = extraction.viewerChromeTitleLineText;
  }
  if (Object.hasOwn(extraction, "viewerArticleShellLoaded")) {
    artifactRecord.viewer_article_shell_loaded = extraction.viewerArticleShellLoaded;
  }
  if (Number.isFinite(extraction.viewerContentLines)) {
    artifactRecord.viewer_content_lines = extraction.viewerContentLines;
  }
  if (Number.isFinite(extraction.viewerMetadataLines)) {
    artifactRecord.viewer_metadata_lines = extraction.viewerMetadataLines;
  }
  if (Number.isFinite(extraction.viewerReadyAttempts)) {
    artifactRecord.viewer_ready_attempts = extraction.viewerReadyAttempts;
  }
  if (Number.isFinite(extraction.viewerReadyWaitMs)) {
    artifactRecord.viewer_ready_wait_ms = extraction.viewerReadyWaitMs;
  }
}

function buildViewerDiagnostics(viewerContext, readyState = null) {
  const ocrAnalysis = viewerContext?.ocrAnalysis ?? {};
  return {
    viewerReadyState: readyState ?? (viewerContext ? viewerContextReadyState(viewerContext) : "unknown"),
    viewerTitleLineText: ocrAnalysis.titleLine?.text ?? null,
    viewerTitleMatched: Boolean(ocrAnalysis.titleMatched),
    viewerTitleSource: ocrAnalysis.titleSource ?? "unknown",
    viewerH1LineText: ocrAnalysis.h1Line?.text ?? null,
    viewerChromeTitleLineText: ocrAnalysis.chromeTitleLine?.text ?? null,
    viewerArticleShellLoaded: Boolean(ocrAnalysis.articleShellLoaded),
    viewerContentLines: Number(ocrAnalysis.contentLines ?? 0),
    viewerMetadataLines: Number(ocrAnalysis.metadataLines ?? 0),
    viewerReadyAttempts: Number(viewerContext?.viewerReadyAttempts ?? 0),
    viewerReadyWaitMs: Number(viewerContext?.viewerReadyWaitMs ?? 0),
  };
}

function viewerLooksLoading(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  return lines.some((line) => /\bloading\b/i.test(line?.text ?? ""));
}

function viewerContextReadyState(viewerContext) {
  const scopedOcrResult = viewerContext?.viewerOcrResult ?? viewerContext?.ocrResult;
  const ocrAnalysis = viewerContext?.ocrAnalysis ?? {};

  if (ocrAnalysis.matched || ocrAnalysis.articleShellLoaded) return "ready";
  if (viewerLooksLoading(scopedOcrResult)) return "loading";
  if (classifyViewerContentSkipReason(scopedOcrResult, ocrAnalysis)) return "ready";
  if (ocrAnalysis.titleLine) return "partial_title";
  return "unknown";
}

function viewerContextStillLoading(viewerContext) {
  const state = viewerContextReadyState(viewerContext);
  return state === "loading" || state === "partial_title";
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

function looksLikeTextShareCandidate(candidate) {
  if (candidate?.cardType === "text_share_card") return true;
  return looksLikeTextShareCardText(
    String(candidate?.rawText ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    [candidate?.title, candidate?.rawText].filter(Boolean).join("\n")
  );
}

function stripTextShareHeader(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/^.*?文字分享[:：]?\s*/, "")
    .trim();
}

function buildTextShareViewerTitleAliases(candidate) {
  const lines = String(candidate?.rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);
  const aliases = [];

  for (const line of [candidate?.title, ...lines]) {
    const stripped = stripTextShareHeader(line);
    if (!stripped || /文字分享/.test(stripped)) continue;
    if (looksLikeArticleSourceFooter(stripped)) continue;
    aliases.push(stripped);
  }

  const bodyLines = lines
    .map(stripTextShareHeader)
    .filter((line) => line && !/文字分享/.test(line) && !looksLikeArticleSourceFooter(line));
  if (bodyLines.length >= 2) {
    aliases.push(`${bodyLines[0]}${bodyLines[1]}`);
    aliases.push(`${bodyLines[0]} ${bodyLines[1]}`);
  }

  return aliases;
}

function buildOcrFallbackViewerTitleAliases(candidate, { includeWeak = false } = {}) {
  if (candidate?.cardType !== "single_article_card") return [];

  const lines = String(candidate?.rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);

  const aliases = [];
  const seen = new Set();
  const addAlias = (value, { allowLong = false } = {}) => {
    const alias = String(value ?? "").normalize("NFKC").replace(/[⋯…]+/g, "").trim();
    const normalized = normalizeComparableText(alias);
    if (normalized.length < 4 || (!allowLong && normalized.length > 24)) return;
    if (seen.has(normalized)) return;
    if (looksLikeTimestampOcrText(alias) || looksLikeUrlLikeText(alias)) return;
    if (/[=＝]|[，,。！？；!?、]/.test(alias)) return;
    seen.add(normalized);
    aliases.push(alias);
  };

  lines.forEach((line, index) => {
    if (lines.length >= 3 && index >= lines.length - 2 && looksLikeArticleSourceFooter(line)) {
      return;
    }

    const strippedEllipsis = line.replace(/(?:\.{3}|[⋯…]+)/g, "").trim();
    addAlias(strippedEllipsis, { allowLong: true });

    if (includeWeak) {
      const beforeYear = strippedEllipsis.replace(/\s*(?:19|20)\d{2}.*$/u, "").trim();
      addAlias(beforeYear);
    }

    const prefix = strippedEllipsis.slice(0, 16).trim();
    addAlias(prefix);
  });

  return aliases;
}

function buildViewerTitleAliases(candidate, { includeWeak = false } = {}) {
  const base = [candidate?.title ?? candidate?.rawText ?? ""];
  if (looksLikeTextShareCandidate(candidate)) {
    base.push(...buildTextShareViewerTitleAliases(candidate));
  } else {
    base.push(...buildOcrFallbackViewerTitleAliases(candidate, { includeWeak }));
  }

  const seen = new Set();
  const aliases = [];
  for (const alias of base) {
    const normalized = normalizeComparableText(alias);
    if (normalized.length < 4 || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(normalized);
  }
  return aliases;
}

function findViewerTitleLine(ocrResult, candidate, { includeWeak = false } = {}) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageHeight = Number(ocrResult?.height ?? 0);
  const titleAliases = buildViewerTitleAliases(candidate, { includeWeak });
  if (titleAliases.length === 0) return null;

  let best = null;
  for (const line of lines) {
    if (!line?.text) continue;
    if (imageHeight > 0 && line.y > imageHeight * 0.45) continue;
    const normalized = normalizeComparableText(line.text);
    if (!normalized || normalized.length < 6) continue;

    let score = 0;
    for (const titleNorm of titleAliases) {
      let aliasScore = 0;
      if (normalized.includes(titleNorm)) aliasScore += 30;
      else if (titleNorm.includes(normalized) && normalized.length >= 8) aliasScore += 22;
      else {
        const probe = titleNorm.slice(0, Math.min(titleNorm.length, 14));
        if (probe && normalized.includes(probe)) aliasScore += 18;
        else if (probe && probe.includes(normalized) && normalized.length >= 6) aliasScore += 12;
      }
      score = Math.max(score, aliasScore);
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

function looksLikeViewerChromeLine(text) {
  const value = String(text ?? "").normalize("NFKC").trim();
  if (!value) return true;
  if (/^(?:x|×|close|search|summary|ok)$/i.test(value)) return true;
  if (/summary provided|provided by|yuanbao|loading|微信|WeChat|search/i.test(value)) return true;
  if (FILE_HELPER_NAMES.some((name) => normalizeComparableText(value) === normalizeComparableText(name))) return true;
  if (looksLikeUrlLikeText(value)) return true;
  if (normalizeComparableText(value).length === 0) return true;
  return false;
}

function findLikelyArticleTitleCandidate(ocrResult) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageWidth = Number(ocrResult?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? 0);
  const titleZone = imageHeight > 0 ? imageHeight * 0.45 : Number.POSITIVE_INFINITY;
  const firstArticleMetadataY = lines
    .filter((line) => line?.text && looksLikeLoadedArticleMetadataLine(line.text))
    .map((line) => Number(line.y ?? Number.POSITIVE_INFINITY))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const candidates = [];

  for (const line of lines) {
    if (!line?.text) continue;
    if (line.y > titleZone) continue;
    if (Number.isFinite(firstArticleMetadataY) && line.y > firstArticleMetadataY + 20) continue;
    if (looksLikeViewerChromeLine(line.text)) continue;
    if (looksLikeLoadedArticleMetadataLine(line.text)) continue;

    const normalized = normalizeComparableText(line.text);
    if (normalized.length < 6) continue;
    if (Number(line.width ?? 0) < 120 && normalized.length < 10) continue;

    const widthRatio = imageWidth > 0 ? Number(line.width ?? 0) / imageWidth : 0;
    const yRatio = imageHeight > 0 ? Number(line.y ?? 0) / imageHeight : 0.2;
    const score =
      Math.min(24, widthRatio * 56) +
      (Number(line.height ?? 0) >= 24 ? 8 : 0) +
      Math.min(16, normalized.length) +
      (yRatio >= 0.07 ? 8 : 0);
    candidates.push({ line, score });
  }

  candidates.sort((a, b) => b.score - a.score || a.line.y - b.line.y);
  const articleH1 = candidates[0]?.line ?? null;
  const chromeTitle =
    articleH1 == null
      ? null
      : candidates.find((candidate) => {
          const line = candidate.line;
          if (line === articleH1) return false;
          if (imageHeight > 0 && line.y > imageHeight * 0.08) return false;
          if (line.y >= articleH1.y) return false;
          return Number(line.width ?? 0) < Number(articleH1.width ?? 0) * 0.8;
        })?.line ?? null;

  return {
    line: articleH1,
    h1Line: articleH1,
    chromeTitleLine: chromeTitle,
    source: articleH1 ? "article_h1" : "unknown",
  };
}

function looksLikeLoadedArticleMetadataLine(text) {
  const value = String(text ?? "");
  if (/summary provided|yuanbao/i.test(value)) return false;
  return /原创|original|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}/i.test(value);
}

function lineBottom(line) {
  return Number(line?.y ?? 0) + Number(line?.height ?? 0);
}

function findTitleContinuationLines(lines, titleLine, imageWidth, imageHeight) {
  if (!titleLine) return [];
  const titleBottom = lineBottom(titleLine);
  const titleHeight = Math.max(1, Number(titleLine.height ?? 0));
  const maxGap = Math.max(64, titleHeight * 1.6);
  const titleZone = imageHeight > 0 ? imageHeight * 0.45 : Number.POSITIVE_INFINITY;
  const leftTolerance = Math.max(90, imageWidth * 0.08);
  const continuationLines = [];
  let previousBottom = titleBottom;

  const belowLines = lines
    .filter((line) => line && line !== titleLine && line.text)
    .filter((line) => Number(line.y ?? 0) >= titleBottom - 4 && Number(line.y ?? 0) <= titleZone)
    .sort((a, b) => a.y - b.y);

  for (const line of belowLines) {
    const gap = Number(line.y ?? 0) - previousBottom;
    if (gap > maxGap) break;
    if (looksLikeLoadedArticleMetadataLine(line.text) || looksLikeArticleSourceFooter(line.text)) break;
    if (looksLikeViewerChromeLine(line.text)) continue;

    const normalized = normalizeComparableText(line.text);
    const leftAligned = Math.abs(Number(line.x ?? 0) - Number(titleLine.x ?? 0)) <= leftTolerance;
    const titleLikeHeight = Number(line.height ?? 0) >= Math.max(18, titleHeight * 0.55);
    const titleLikeWidth = Number(line.width ?? 0) >= Math.max(80, Number(titleLine.width ?? 0) * 0.18);
    if (!leftAligned || !titleLikeHeight || !titleLikeWidth || normalized.length < 2) break;

    continuationLines.push(line);
    previousBottom = Math.max(previousBottom, lineBottom(line));
    if (continuationLines.length >= 3) break;
  }

  return continuationLines;
}

function analyzeArticleStructureForTitle(lines, titleLine, imageWidth, imageHeight) {
  if (!titleLine) {
    return {
      contentLines: 0,
      metadataLines: 0,
      articleMetadataLines: 0,
      titleBlockBottom: 0,
      articleShellLoaded: false,
    };
  }

  const continuationLines = findTitleContinuationLines(lines, titleLine, imageWidth, imageHeight);
  const titleBlockBottom = Math.max(lineBottom(titleLine), ...continuationLines.map(lineBottom));
  const metadataBottom = titleBlockBottom + 150;
  const contentLines = lines.filter(
    (line) =>
      line.text &&
      line.y > titleBlockBottom + 8 &&
      line.y < imageHeight * 0.92 &&
      line.x > titleLine.x - imageWidth * 0.08 &&
      line.x < titleLine.x + imageWidth * 0.18 &&
      line.width > Math.max(140, imageWidth * 0.14)
  ).length;
  const metadataLines = lines.filter(
    (line) =>
      line.text &&
      line.y >= titleLine.y - 24 &&
      line.y <= metadataBottom &&
      /原创|original|summary provided|年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}|数字生命|yuanbao/i.test(line.text)
  ).length;
  const articleMetadataLines = lines.filter(
    (line) =>
      line.text &&
      line.y >= titleLine.y - 24 &&
      line.y <= metadataBottom &&
      looksLikeLoadedArticleMetadataLine(line.text)
  ).length;

  return {
    contentLines,
    metadataLines,
    articleMetadataLines,
    titleBlockBottom,
    articleShellLoaded: articleMetadataLines >= 1 || contentLines >= 4,
  };
}

function analyzeViewerOcr(ocrResult, candidate) {
  const lines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const imageWidth = Number(ocrResult?.width ?? 0);
  const imageHeight = Number(ocrResult?.height ?? 0);
  const matchedTitleLine = findViewerTitleLine(ocrResult, candidate);
  const weakTitleLine = matchedTitleLine ? null : findViewerTitleLine(ocrResult, candidate, { includeWeak: true });
  const likelyArticleTitle = findLikelyArticleTitleCandidate(ocrResult);
  let titleLine = matchedTitleLine ?? weakTitleLine ?? likelyArticleTitle.line;
  let titleSource = matchedTitleLine ? "matched_title" : weakTitleLine ? "weak_title_alias" : likelyArticleTitle.source;
  const likelyArticleStructure = analyzeArticleStructureForTitle(
    lines,
    likelyArticleTitle.line,
    imageWidth,
    imageHeight
  );
  const titleLineLooksLikeMetadata = titleLine ? looksLikeLoadedArticleMetadataLine(titleLine.text) : false;
  if (
    likelyArticleTitle.line &&
    titleLine &&
    likelyArticleTitle.line !== titleLine &&
    ((likelyArticleTitle.line.y > titleLine.y + 40 &&
      Number(likelyArticleTitle.line.width ?? 0) > Number(titleLine.width ?? 0) * 1.35) ||
      (lineBottom(likelyArticleTitle.line) < Number(titleLine.y ?? 0) - (titleLineLooksLikeMetadata ? 8 : 40) &&
        likelyArticleStructure.articleShellLoaded))
  ) {
    titleLine = likelyArticleTitle.line;
    titleSource = "article_h1";
  } else if (likelyArticleTitle.line && likelyArticleTitle.line === titleLine) {
    titleSource = "article_h1";
  }
  const chromeTitleLine =
    likelyArticleTitle.chromeTitleLine ??
    (titleSource !== "article_h1" && titleLine && imageHeight > 0 && titleLine.y <= imageHeight * 0.08
      ? titleLine
      : null);
  const h1Line = titleSource === "article_h1" ? titleLine : likelyArticleTitle.h1Line;
  const chatHistoryModal = lines.some((line) => /chat history with/i.test(line.text));
  if (!titleLine || chatHistoryModal) {
    return {
      matched: false,
      titleMatched: false,
      titleLine,
      titleSource: titleLine ? titleSource : "unknown",
      h1Line,
      chromeTitleLine,
      chatHistoryModal,
      contentLines: 0,
      metadataLines: 0,
      articleMetadataLines: 0,
      articleShellLoaded: false,
    };
  }

  const articleStructure = analyzeArticleStructureForTitle(lines, titleLine, imageWidth, imageHeight);
  const { contentLines, metadataLines, articleMetadataLines } = articleStructure;

  return {
    matched:
      (Boolean(matchedTitleLine && titleLine === matchedTitleLine) || titleSource === "article_h1") &&
      contentLines >= 4 &&
      (metadataLines >= 1 || titleLine.width >= imageWidth * 0.2),
    titleMatched: Boolean(matchedTitleLine && titleLine === matchedTitleLine),
    titleLine,
    titleSource,
    h1Line,
    chromeTitleLine,
    chatHistoryModal,
    contentLines,
    metadataLines,
    articleMetadataLines,
    articleShellLoaded: articleMetadataLines >= 1 || (titleSource === "article_h1" && contentLines >= 4),
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
    const newWindow =
      currentWindows.length > beforeWindows.length
        ? currentWindows.find((window) => !beforeSignatures.has(windowSignature(window)))
        : null;
    const frontWindowChanged = frontWindow && windowSignature(frontWindow) !== beforeFrontSignature;
    const preferredScreenshotRect = newWindow ?? (frontWindowChanged ? frontWindow : null) ?? beforeFrontWindow ?? null;

    const stamp = `${Date.now()}`;
    const screenshotPath =
      artifactDir != null
        ? path.join(artifactDir, `viewer-detect-${stamp}.png`)
        : path.join(os.tmpdir(), `wechat-viewer-detect-${stamp}.png`);

    const screenBounds = captureFullScreenScreenshotFn(screenshotPath, preferredScreenshotRect);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const fullScreenOcrAnalysis = analyzeViewerOcr(ocrResult, candidate);

    if (artifactDir != null) {
      await writeJsonArtifact(path.join(artifactDir, `viewer-detect-${stamp}.ocr.json`), ocrResult);
    } else {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }

    if (newWindow) {
      const viewerOcrContext = buildViewerOcrContext(ocrResult, newWindow, screenBounds, candidate);
      return {
        mode: "new_window",
        screenRect: newWindow,
        screenBounds: viewerOcrContext.screenBounds,
        window: newWindow,
        ocrResult,
        viewerOcrResult: viewerOcrContext.viewerOcrResult,
        ocrAnalysis: viewerOcrContext.ocrAnalysis,
      };
    }

    if (frontWindowChanged) {
      const viewerOcrContext = buildViewerOcrContext(ocrResult, frontWindow, screenBounds, candidate);
      return {
        mode: "front_window_changed",
        screenRect: frontWindow,
        screenBounds: viewerOcrContext.screenBounds,
        window: frontWindow,
        ocrResult,
        viewerOcrResult: viewerOcrContext.viewerOcrResult,
        ocrAnalysis: viewerOcrContext.ocrAnalysis,
      };
    }

    if (fullScreenOcrAnalysis.matched || fullScreenOcrAnalysis.articleShellLoaded) {
      if (debug) {
        console.log("[debug] Detected article viewer via full-screen OCR");
      }
      const ocrDetectedRect = frontWindow ?? screenBounds;
      const viewerOcrContext = buildViewerOcrContext(ocrResult, ocrDetectedRect, screenBounds, candidate);
      return {
        mode: "ocr_detected",
        screenRect: ocrDetectedRect,
        screenBounds: viewerOcrContext.screenBounds,
        window: frontWindow ?? null,
        ocrResult,
        viewerOcrResult: viewerOcrContext.viewerOcrResult,
        ocrAnalysis: viewerOcrContext.ocrAnalysis,
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
  const readyStartedAt = Date.now();
  let attempts = 0;
  const initiallyReady = viewerContextReadyState(currentContext) === "ready";

  if (initiallyReady) {
    return {
      ...currentContext,
      viewerReadyAttempts: attempts,
      viewerReadyWaitMs: Date.now() - readyStartedAt,
    };
  }

  if (!viewerContextStillLoading(currentContext)) {
    return {
      ...currentContext,
      viewerReadyAttempts: attempts,
      viewerReadyWaitMs: Date.now() - readyStartedAt,
    };
  }

  if (debug) {
    console.log("[debug] Waiting for article viewer to finish loading...");
  }

  const deadline = readyStartedAt + timeoutMs;
  while (Date.now() < deadline) {
    sleepMsFn(pollMs);
    attempts += 1;

    const stamp = `${Date.now()}`;
    const screenshotPath =
      artifactDir != null
        ? path.join(artifactDir, `viewer-ready-${stamp}.png`)
        : path.join(os.tmpdir(), `wechat-viewer-ready-${stamp}.png`);

    const frontWindow = getFrontWeChatWindowFn();
    const screenRect = currentContext.screenRect ?? frontWindow ?? currentContext.screenBounds;
    const screenBounds = captureFullScreenScreenshotFn(screenshotPath, screenRect);
    const ocrResult = await recognizeTextFromImageFn(screenshotPath);
    const viewerOcrContext = buildViewerOcrContext(ocrResult, screenRect, screenBounds, candidate);

    currentContext = {
      ...currentContext,
      screenBounds: viewerOcrContext.screenBounds,
      screenRect,
      window: frontWindow ?? currentContext.window ?? null,
      ocrResult,
      viewerOcrResult: viewerOcrContext.viewerOcrResult,
      ocrAnalysis: viewerOcrContext.ocrAnalysis,
      viewerReadyAttempts: attempts,
      viewerReadyWaitMs: Date.now() - readyStartedAt,
    };

    if (artifactDir != null) {
      await writeJsonArtifact(path.join(artifactDir, `viewer-ready-${stamp}.ocr.json`), ocrResult);
    } else {
      await fs.rm(screenshotPath, { force: true }).catch(() => {});
    }

    const readyState = viewerContextReadyState(currentContext);
    if (readyState === "ready") {
      return currentContext;
    }
    if (readyState === "unknown") {
      return currentContext;
    }
  }

  return {
    ...currentContext,
    viewerReadyAttempts: attempts,
    viewerReadyWaitMs: Date.now() - readyStartedAt,
  };
}

function viewerContextLooksMismatched(viewerContext, candidate) {
  if (viewerContext?.ocrAnalysis?.titleLine) return false;
  const candidateKey = normalizeComparableText(candidate?.title ?? candidate?.rawText ?? "");
  if (candidateKey.length < 8) return false;
  const scopedOcrResult = viewerContext?.viewerOcrResult ?? viewerContext?.ocrResult;
  if (viewerLooksLoading(scopedOcrResult)) return false;
  return countMeaningfulOcrLines(scopedOcrResult) > 0;
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
    getFrontWeChatWindowFn = getFrontWeChatWindow,
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

export async function extractShareCardUrl(
  candidate,
  { debug = false, artifactDir = null, allowBrowserFallback = true } = {},
  {
    clearClipboardTextFn = clearClipboardText,
    clickAtPointFn = clickAtPoint,
    getWeChatWindowsFn = getWeChatWindows,
    getFrontWeChatWindowFn = getFrontWeChatWindow,
    captureFullScreenScreenshotFn = captureFullScreenScreenshot,
    recognizeTextFromImageFn = recognizeTextFromImage,
    openViewerMenuFn = openViewerMenu,
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

  const viewerContext = await detectViewerContext(
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
  timings.viewer_open_wait_ms = Date.now() - openStartedAt;

  if (!viewerContext) {
    return {
      status: "failed",
      reason: "share_card_viewer_not_opened",
      timings,
      ...buildViewerDiagnostics(null, "not_opened"),
    };
  }

  const readyStartedAt = Date.now();
  const readyViewerContext = await waitForViewerReady(
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

  const readyState = viewerContextReadyState(readyViewerContext);
  const viewerDiagnostics = buildViewerDiagnostics(readyViewerContext, readyState);

  if (artifactDir != null) {
    await writeJsonArtifact(path.join(artifactDir, "viewer-context.json"), {
      mode: readyViewerContext.mode,
      screen_rect: readyViewerContext.screenRect,
      screen_bounds: readyViewerContext.screenBounds,
      window: readyViewerContext.window,
      ready_state: readyState,
      title_line_text: readyViewerContext.ocrAnalysis?.titleLine?.text ?? null,
      title_matched: Boolean(readyViewerContext.ocrAnalysis?.titleMatched),
      title_source: readyViewerContext.ocrAnalysis?.titleSource ?? "unknown",
      h1_line_text: readyViewerContext.ocrAnalysis?.h1Line?.text ?? null,
      chrome_title_line_text: readyViewerContext.ocrAnalysis?.chromeTitleLine?.text ?? null,
      content_lines: readyViewerContext.ocrAnalysis?.contentLines ?? 0,
      metadata_lines: readyViewerContext.ocrAnalysis?.metadataLines ?? 0,
      article_metadata_lines: readyViewerContext.ocrAnalysis?.articleMetadataLines ?? 0,
      article_shell_loaded: Boolean(readyViewerContext.ocrAnalysis?.articleShellLoaded),
      ready_attempts: readyViewerContext.viewerReadyAttempts ?? 0,
      ready_wait_ms: readyViewerContext.viewerReadyWaitMs ?? timings.viewer_ready_wait_ms,
    });
  }

  if (readyState === "loading" || readyState === "partial_title") {
    const closeStartedAt = Date.now();
    const closeResult = normalizeCloseViewerResult(
      closeViewerWindowFn(beforeWindows, { debug }),
      beforeWindows,
      getFrontWeChatWindowFn
    );
    let recovered = false;
    if (closeResult.closed && fastChatRecoveryLooksGood(beforeWindows, closeResult.currentWindows, closeResult.frontWindow)) {
      recovered = true;
    } else {
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!recovered && typeof recoverChatFn === "function") {
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    timings.viewer_close_wait_ms = Date.now() - closeStartedAt;
    if (!closeResult.closed || !recovered) {
      return {
        status: "failed",
        reason: !closeResult.closed ? "viewer_not_closed" : "chat_not_recovered",
        url: null,
        usedBrowserFallback: false,
        timings,
        ...viewerDiagnostics,
      };
    }
    return {
      status: "failed",
      reason: "viewer_not_ready",
      url: null,
      usedBrowserFallback: false,
      timings,
      ...viewerDiagnostics,
    };
  }

  if (viewerContextLooksMismatched(readyViewerContext, candidate)) {
    const closeStartedAt = Date.now();
    const closeResult = normalizeCloseViewerResult(
      closeViewerWindowFn(beforeWindows, { debug }),
      beforeWindows,
      getFrontWeChatWindowFn
    );
    let recovered = false;
    if (closeResult.closed && fastChatRecoveryLooksGood(beforeWindows, closeResult.currentWindows, closeResult.frontWindow)) {
      recovered = true;
    } else {
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!recovered && typeof recoverChatFn === "function") {
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    timings.viewer_close_wait_ms = Date.now() - closeStartedAt;
    if (!closeResult.closed || !recovered) {
      return {
        status: "failed",
        reason: !closeResult.closed ? "viewer_not_closed" : "chat_not_recovered",
        url: null,
        usedBrowserFallback: false,
        timings,
        ...viewerDiagnostics,
      };
    }
    return {
      status: "failed",
      reason: "viewer_context_mismatch",
      url: null,
      usedBrowserFallback: false,
      timings,
      ...viewerDiagnostics,
    };
  }

  const viewerSkipReason = classifyViewerContentSkipReason(
    readyViewerContext.viewerOcrResult ?? readyViewerContext.ocrResult,
    readyViewerContext.ocrAnalysis
  );
  if (viewerSkipReason) {
    const closeStartedAt = Date.now();
    const closeResult = normalizeCloseViewerResult(
      closeViewerWindowFn(beforeWindows, { debug }),
      beforeWindows,
      getFrontWeChatWindowFn
    );
    let recovered = false;
    if (closeResult.closed && fastChatRecoveryLooksGood(beforeWindows, closeResult.currentWindows, closeResult.frontWindow)) {
      recovered = true;
    } else {
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    if (!recovered && typeof recoverChatFn === "function") {
      await recoverChatFn(debug);
      recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    }
    timings.viewer_close_wait_ms = Date.now() - closeStartedAt;
    if (!closeResult.closed || !recovered) {
      return {
        status: "failed",
        reason: !closeResult.closed ? "viewer_not_closed" : "chat_not_recovered",
        url: null,
        usedBrowserFallback: false,
        timings,
        ...viewerDiagnostics,
      };
    }
    return {
      status: "skipped",
      reason: viewerSkipReason,
      url: null,
      usedBrowserFallback: false,
      timings,
      ...viewerDiagnostics,
    };
  }

  let url = null;
  let usedBrowserFallback = false;
  let reason = "viewer_detected_but_menu_not_found";
  let status = "failed";
  let copyAttempts = 0;
  let copyLastClipboardText = "";
  let copyFailureReason = null;
  let copyUrlKind = null;
  let copiedUrlHost = null;

  try {
    const menuStartedAt = Date.now();
    let menu = await openViewerMenuFn(
      readyViewerContext,
      { debug, artifactDir },
      {
        clickAtPointFn,
        getWeChatWindowsFn,
        getFrontWeChatWindowFn,
        captureFullScreenScreenshotFn,
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
      const copyResult = waitForClipboardShareUrl({}, { readClipboardTextFn, sleepMsFn });
      url = copyResult.url;
      copyAttempts = copyResult.attempts;
      copyLastClipboardText = copyResult.lastClipboardText;
      copyUrlKind = classifyCopiedUrlKind(url);
      copiedUrlHost = getUrlHost(url);
      timings.viewer_copy_wait_ms += Date.now() - copyStartedAt;
      if (url) {
        status = "ok";
      }
      if (!url) {
        reason = "copy_link_failed";
        copyFailureReason = "clipboard_timeout";
        if (allowBrowserFallback) {
          const fallbackMenuStartedAt = Date.now();
          menu = await openViewerMenuFn(
            readyViewerContext,
            { debug, artifactDir },
            {
              clickAtPointFn,
              getWeChatWindowsFn,
              getFrontWeChatWindowFn,
              captureFullScreenScreenshotFn,
              recognizeTextFromImageFn,
              sleepMsFn,
            }
          );
          timings.viewer_menu_wait_ms += Date.now() - fallbackMenuStartedAt;
        }
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
      const parsedBrowserUrl = extractHttpUrlFromText(browserUrl);
      if (parsedBrowserUrl) {
        usedBrowserFallback = true;
        url = parsedBrowserUrl;
        copyUrlKind = classifyCopiedUrlKind(url);
        copiedUrlHost = getUrlHost(url);
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

  return {
    status,
    reason,
    usedBrowserFallback,
    url,
    timings,
    copyAttempts,
    copyLastClipboardText: summarizeClipboardText(copyLastClipboardText),
    copyFailureReason,
    copyUrlKind,
    copiedUrlHost,
    ...viewerDiagnostics,
  };
}
