import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a URL to a canonical form for deduplication:
 * - Lowercase the host
 * - Remove fragment (#...)
 * - Remove trailing slash from pathname
 * - For WeChat article URLs (mp.weixin.qq.com/s/...), strip extra query params
 */
export function canonicalizeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  parsed.host = parsed.host.toLowerCase();
  parsed.hash = "";

  // WeChat article shortlinks: mp.weixin.qq.com/s/<token>
  // Keep only the path, drop all query params that are tracking-only
  if (parsed.host === "mp.weixin.qq.com" && parsed.pathname.startsWith("/s/")) {
    parsed.search = "";
  }

  let result = parsed.toString();
  // Remove trailing slash from path (but not for bare origins like https://example.com/)
  if (result.endsWith("/") && parsed.pathname.length > 1) {
    result = result.slice(0, -1);
  }

  return result;
}

/** Return true if the URL looks like a video-channel or Bilibili video card (skip these). */
export function shouldSkipUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname;

    // WeChat video channel (视频号)
    if (host.includes("channels.weixin.qq.com")) return true;
    if (host === "mp.weixin.qq.com" && pathname.startsWith("/mp/wma")) return true;

    // Bilibili video URLs (not article/column links)
    if (host === "www.bilibili.com" || host === "bilibili.com" || host === "m.bilibili.com") {
      if (pathname.startsWith("/video/")) return true;
      if (pathname.startsWith("/bangumi/")) return true;
    }
    // Short bilibili links
    if (host === "b23.tv") return true;
  } catch {
    // not a valid URL, skip
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Generate a stable dedup key from chat name + message time + canonical URL.
 * Does NOT include title so the key is stable across re-runs.
 */
export function dedupeKey(chatName, messageTime, canonicalUrl) {
  const seed = `${String(chatName).trim()}|${String(messageTime).trim()}|${String(canonicalUrl).trim()}`;
  return crypto.createHash("sha256").update(seed, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// JSONL I/O
// ---------------------------------------------------------------------------

export async function readJsonlines(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writeJsonlines(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
  await fs.writeFile(filePath, text, "utf8");
}

/**
 * Merge incoming records into the existing index, deduplicating by dedupe_key.
 * Returns the merged array (existing first, then new).
 */
export function mergeRecords(existing, incoming) {
  const seen = new Set(existing.map((r) => r.dedupe_key));
  const added = incoming.filter((r) => !seen.has(r.dedupe_key));
  return [...existing, ...added];
}

// ---------------------------------------------------------------------------
// Time-range filtering
// ---------------------------------------------------------------------------

/**
 * Filter records whose message_time falls within [since, until] (inclusive).
 * @param {object[]} records
 * @param {Date} since
 * @param {Date} until
 */
export function filterByTimeRange(records, since, until) {
  return records.filter((r) => {
    const t = new Date(r.message_time);
    return t >= since && t <= until;
  });
}

// ---------------------------------------------------------------------------
// WeChat Web timestamp parsing
// ---------------------------------------------------------------------------

/**
 * Parse a WeChat Web timestamp string into a Date.
 * Formats observed on wx.qq.com (China time, UTC+8):
 *   "10:30"              → today HH:MM
 *   "昨天 10:30"         → yesterday HH:MM
 *   "3月22日 15:00"      → this year M月D日 HH:MM
 *   "2026年3月22日 15:00" → YYYY年M月D日 HH:MM
 *
 * @param {string} text  Raw timestamp text from WeChat Web DOM
 * @param {Date} [referenceDate]  Defaults to now (for testability)
 * @returns {Date|null}
 */
export function parseWeChatTimestamp(text, referenceDate) {
  if (!text) return null;
  text = text.trim();
  const ref = referenceDate ?? new Date();
  // Use UTC+8 offset for reference
  const refCst = toCST(ref);

  // Full: "2026年3月22日 15:00" or "2026年3月22日"
  let m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return buildCstDate(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  }

  // Month+day: "3月22日 15:00"
  m = text.match(/^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return buildCstDate(refCst.year, +m[1], +m[2], +(m[3] ?? 0), +(m[4] ?? 0));
  }

  // Yesterday: "昨天 10:30"
  m = text.match(/^昨天\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const yesterday = new Date(ref);
    yesterday.setDate(yesterday.getDate() - 1);
    const yc = toCST(yesterday);
    return buildCstDate(yc.year, yc.month, yc.day, +m[1], +m[2]);
  }

  // Today: "10:30"
  m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    return buildCstDate(refCst.year, refCst.month, refCst.day, +m[1], +m[2]);
  }

  return null;
}

/** Decompose a Date into CST (UTC+8) year/month/day components. */
function toCST(date) {
  const cstMs = date.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(cstMs);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Build a Date from CST year/month/day/hour/minute components. */
function buildCstDate(year, month, day, hour, minute) {
  // Construct as UTC by subtracting 8h offset
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

export function newCaptureSessionId() {
  return crypto.randomUUID();
}

export function newRunTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
