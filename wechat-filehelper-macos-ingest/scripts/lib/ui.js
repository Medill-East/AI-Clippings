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
const OCR_RIGHT_PANE_RATIO = 0.58;
const OCR_TOP_CONTENT_RATIO = 0.15;
const OCR_CLUSTER_GAP_PX = 54;
const VIEWER_OPEN_SETTLE_MS = 380;
const VIEWER_DETECT_TIMEOUT_MS = 1_200;
const VIEWER_DETECT_POLL_MS = 100;
const VIEWER_READY_TIMEOUT_MS = 800;
const VIEWER_READY_POLL_MS = 90;
const VIEWER_MENU_SETTLE_MS = 120;
const VIEWER_COPY_SETTLE_MS = 80;
const VIEWER_BROWSER_SETTLE_MS = 700;
const VIEWER_CLOSE_INITIAL_SETTLE_MS = 50;
const VIEWER_CLOSE_ESCAPE_SETTLE_MS = 100;
const VIEWER_CLOSE_CMD_W_SETTLE_MS = 140;

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
    /^(\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)$/.test(value) ||
    /^(\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)$/.test(value)
  );
}

export function inferShareCardItemsFromOcr(ocrLines, { imageWidth = 0, imageHeight = 0 } = {}) {
  const rightBoundary = imageWidth * OCR_RIGHT_PANE_RATIO;
  const topBoundary = imageHeight * OCR_TOP_CONTENT_RATIO;
  const candidateLines = [];
  const timestampLines = [];

  for (const line of ocrLines) {
    if (!line?.text) continue;
    if (line.y < topBoundary) continue;

    const centerX = line.x + line.width / 2;
    if (looksLikeTimestampOcrText(line.text) && centerX < imageWidth * 0.55) {
      timestampLines.push(line);
      continue;
    }

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

  const items = [];
  let index = 0;
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;

    const rawText = cluster.map((line) => line.text).join(" ").trim();
    if (!rawText) continue;

    const title = cluster
      .slice(0, Math.min(cluster.length, 2))
      .map((line) => line.text)
      .join(" ")
      .trim();
    const timestampLine = findNearestTimestampLine(cluster[0], timestampLines);
    const skipReason = classifyOcrShareCardSkipReason(rawText);

    items.push({
      kind: "share_card",
      itemKey: `ocr-item-${index++}`,
      timestampText: timestampLine?.text ?? null,
      rawText,
      title,
      skipReason,
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
      before = line;
      continue;
    }
    after = line;
    break;
  }

  return before ?? after ?? null;
}

function classifyOcrShareCardSkipReason(rawText) {
  if (/视频号|video\s+channel/i.test(rawText)) return "video_channel";
  if (/哔哩哔哩|bilibili|b23\.tv|UP主|播放[:：]/i.test(rawText)) return "bilibili_video";
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

export function buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds }) {
  const ocrLines = Array.isArray(ocrResult?.lines) ? ocrResult.lines : [];
  const titleLine = findFileHelperTitleLine(ocrLines, ocrResult?.height ?? windowBounds?.height ?? 0);
  const items = clipboardSnapshot?.items ?? [];
  const clipboardHasShareCards = items.some((item) => item.kind === "share_card");
  const ocrFallbackItems = clipboardHasShareCards
    ? []
    : inferShareCardItemsFromOcr(ocrLines, {
        imageWidth: ocrResult?.width ?? windowBounds?.width ?? 0,
        imageHeight: ocrResult?.height ?? windowBounds?.height ?? 0,
      });
  const effectiveItems = clipboardHasShareCards ? items : [...items, ...ocrFallbackItems];
  const shareCardItems = effectiveItems.filter((item) => item.kind === "share_card" && !item.skipReason);
  const candidates = [];
  const usedLineIndexes = new Set();
  let lastMatchedY = -1;

  for (const item of shareCardItems) {
    const match = findBestShareCardLine({
      item,
      ocrLines,
      usedLineIndexes,
      lastMatchedY,
      imageHeight: ocrResult?.height ?? windowBounds?.height ?? 0,
    });
    if (!match) continue;

    usedLineIndexes.add(match.lineIndex);
    lastMatchedY = match.line.y;
    const clickPoint = mapOcrRectCenterToScreenPoint(windowBounds, match.line, ocrResult);

    candidates.push({
      itemKey: item.itemKey,
      title: item.title,
      timestampText: item.timestampText,
      rawText: item.rawText,
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
    effectiveItems,
    ocrFallbackItems,
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

  let clipboardSnapshot;
  let ocrResult;
  try {
    captureWindowScreenshotFn(window, screenshotPath);
    ocrResult = await recognizeTextFromImageFn(screenshotPath);
    clipboardSnapshot = readVisibleClipboardSnapshotFn(debug);
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
  } = {}
) {
  const sessionId = newCaptureSessionId();
  const now = new Date();
  const stats = {
    source: "ui",
    share_cards_seen: 0,
    share_cards_attempted: 0,
    share_cards_resolved: 0,
    share_cards_unresolved: 0,
    browser_fallback_used: 0,
    skipped_by_rule: {},
  };

  const records = [];
  const seenUrls = new Set();
  const seenKeys = new Set();
  const processedCandidates = new Set();
  const seenPages = new Set();
  const artifactDir = runDir ? path.join(runDir, "artifacts") : null;
  const candidateArtifacts = [];

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

  while (scrollCount <= maxScrolls && !limitReached) {
    const page = await captureVisibleUiPageFn({
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
    });

    const pageSignature = page.clipboardSnapshot.items
      .map((item) => `${item.kind}|${item.timestampText ?? ""}|${item.rawText ?? ""}`)
      .join(";");
    if (seenPages.has(pageSignature)) {
      consecutiveDuplicatePages += 1;
      if (consecutiveDuplicatePages >= 2) break;
    } else {
      seenPages.add(pageSignature);
      consecutiveDuplicatePages = 0;
    }

    stats.share_cards_seen += page.clipboardSnapshot.items.filter((item) => item.kind === "share_card").length;
    for (const [reason, count] of Object.entries(page.clipboardSnapshot.stats.skipped_by_rule)) {
      incrementCount(stats.skipped_by_rule, reason, count);
    }

    let reachedBeforeRange = false;
    for (const item of page.clipboardSnapshot.items) {
      let messageTime = null;
      if (item.timestampText) {
        messageTime = parseWeChatTimestamp(item.timestampText, now);
      }

      if (messageTime) {
        if (messageTime < since) {
          reachedBeforeRange = true;
          continue;
        }
        if (messageTime > until) continue;
      }

      if (item.kind === "text_url") {
        for (const link of item.links) {
          const canonicalUrl = canonicalizeUrl(link.url);
          const skipReason = classifySkipReason(canonicalUrl);
          if (skipReason) {
            incrementCount(stats.skipped_by_rule, skipReason);
            continue;
          }
          if (seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);

          const messageTimeIso = (messageTime ?? now).toISOString();
          const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            chat_name: FILE_HELPER_CHAT_NAME,
            message_type: "text_url",
            title: "",
            url: canonicalUrl,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
        }
        continue;
      }

      if (item.kind !== "share_card" || item.skipReason) {
        continue;
      }

      const candidateFingerprint = `${item.timestampText ?? ""}|${item.title}|${item.rawText}`;
      if (processedCandidates.has(candidateFingerprint)) continue;
      processedCandidates.add(candidateFingerprint);

      const candidate = page.candidateMap.get(item.itemKey);
      const artifactRecord = {
        item_key: item.itemKey,
        title: item.title,
        timestamp_text: item.timestampText,
        raw_text: item.rawText,
        page_index: scrollCount,
        click_x: candidate?.clickX ?? null,
        click_y: candidate?.clickY ?? null,
        status: "pending",
      };
      candidateArtifacts.push(artifactRecord);

      if (!candidate) {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = "ocr_candidate_missing";
        stats.share_cards_unresolved += 1;
        continue;
      }

      stats.share_cards_attempted += 1;
      if (debug) {
        console.log(
          `[debug] Trying share card: ${candidate.title ?? item.title ?? "(untitled)"} @ ${candidate.clickX},${candidate.clickY}`
        );
      }
      const extraction = await extractShareCardUrlFn(candidate, {
        debug,
        artifactDir,
      });

      if (extraction.status === "ok" && extraction.url) {
        const canonicalUrl = canonicalizeUrl(extraction.url);
        const skipReason = classifySkipReason(canonicalUrl);
        if (skipReason) {
          incrementCount(stats.skipped_by_rule, skipReason);
          artifactRecord.status = "skipped";
          artifactRecord.reason = skipReason;
          continue;
        }

        const messageTimeIso = (messageTime ?? now).toISOString();
        const key = dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, canonicalUrl);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          seenUrls.add(canonicalUrl);
          records.push({
            captured_at: new Date().toISOString(),
            message_time: messageTimeIso,
            chat_name: FILE_HELPER_CHAT_NAME,
            message_type: "share_card",
            title: candidate.title ?? "",
            url: canonicalUrl,
            dedupe_key: key,
            capture_session_id: sessionId,
            source: "ui",
          });
        }

        artifactRecord.status = "resolved";
        artifactRecord.url = canonicalUrl;
        artifactRecord.used_browser_fallback = Boolean(extraction.usedBrowserFallback);
        stats.share_cards_resolved += 1;
        if (extraction.usedBrowserFallback) {
          stats.browser_fallback_used += 1;
        }
      } else {
        artifactRecord.status = "unresolved";
        artifactRecord.reason = extraction.reason ?? "share_card_extractor_failed";
        stats.share_cards_unresolved += 1;
      }

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

    scrollCount += 1;
    if (scrollCount <= maxScrolls) {
      scrollPageFn(debug);
    }
  }

  if (artifactDir) {
    await fs.writeFile(
      path.join(artifactDir, "candidates.json"),
      JSON.stringify(candidateArtifacts, null, 2) + "\n",
      "utf8"
    );
  }

  console.log(`Scrolled ${scrollCount} time(s), found ${records.length} unique link(s).`);
  return { records, stats };
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

  const clipboardSnapshot = prefetchedClipboardSnapshot ?? readVisibleClipboardSnapshotFn(debug);
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
  const uiSnapshot = buildUiSnapshot({ clipboardSnapshot, ocrResult, windowBounds: window });
  const mergedClipboardSnapshot = {
    ...clipboardSnapshot,
    items: uiSnapshot.effectiveItems,
    stats: {
      ...clipboardSnapshot.stats,
      share_cards_seen:
        clipboardSnapshot.stats.share_cards_seen + uiSnapshot.ocrFallbackItems.length,
      share_cards_unresolved:
        clipboardSnapshot.stats.share_cards_unresolved +
        uiSnapshot.ocrFallbackItems.filter((item) => !item.skipReason).length,
      skipped_by_rule: { ...clipboardSnapshot.stats.skipped_by_rule },
    },
  };

  for (const item of uiSnapshot.ocrFallbackItems) {
    if (item.skipReason) {
      incrementCount(mergedClipboardSnapshot.stats.skipped_by_rule, item.skipReason);
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
    const screenBounds = captureFullScreenScreenshotFn(screenshotPath);
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

function waitForClipboardMpUrl(
  { timeoutMs = 1_000, pollMs = 80 } = {},
  { readClipboardTextFn = readClipboardText, sleepMsFn = sleepMs } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clipboard = readClipboardTextFn();
    if (clipboard && /^https:\/\/mp\.weixin\.qq\.com\//i.test(clipboard)) {
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
  if (getWeChatWindowsFn().length <= beforeCount) {
    return true;
  }

  sendKeystrokeFn("w", ["command down"]);
  sleepMsFn(VIEWER_CLOSE_CMD_W_SETTLE_MS);

  const closed = getWeChatWindowsFn().length <= beforeCount;
  if (debug && !closed) {
    console.log("[debug] viewer window did not close cleanly");
  }
  return closed;
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
  } = {}
) {
  const beforeWindows = getWeChatWindowsFn();
  clearClipboardTextFn();

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

  if (!viewerContext) {
    return { status: "failed", reason: "share_card_viewer_not_opened" };
  }

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

  if (artifactDir != null) {
    await writeJsonArtifact(path.join(artifactDir, "viewer-context.json"), {
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
  let reason = "viewer_detected_but_menu_not_found";
  let status = "failed";

  try {
    const menu = await openViewerMenuFn(
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

    if (menu.copyLine) {
      clickOcrLineInScreen(
        menu.screenBounds ?? readyViewerContext.screenBounds,
        menu.copyLine,
        menu.ocrResult,
        clickAtPointFn
      );
      sleepMsFn(VIEWER_COPY_SETTLE_MS);
      url = waitForClipboardMpUrl({}, { readClipboardTextFn, sleepMsFn });
      if (url) {
        status = "ok";
      }
      if (!url) {
        reason = "copy_link_failed";
      }
    }

    if (!url && allowBrowserFallback && menu.browserLine) {
      clickOcrLineInScreen(
        menu.screenBounds ?? readyViewerContext.screenBounds,
        menu.browserLine,
        menu.ocrResult,
        clickAtPointFn
      );
      sleepMsFn(VIEWER_BROWSER_SETTLE_MS);
      const browserUrl = readFrontBrowserUrlFromAddressBarFn();
      if (browserUrl && /^https:\/\/mp\.weixin\.qq\.com\//i.test(browserUrl)) {
        usedBrowserFallback = true;
        url = browserUrl;
        status = "ok";
      }
      if (!url) {
        reason = "browser_fallback_failed";
      }
    }
  } finally {
    const closed = closeViewerWindowFn(beforeWindows, { debug });
    const recovered = await verifyChatRecoveredFn({ debug, artifactDir });
    if (!closed || !recovered) {
      reason = !closed ? "viewer_not_closed" : "chat_not_recovered";
      status = "failed";
    }
  }

  return { status, reason, usedBrowserFallback, url };
}
