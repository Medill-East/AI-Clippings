import path from "node:path";

import { formatCstDateTime, parseUserDateTimeInput, readJsonlines, shouldSkipUrl } from "./common.js";

export function parseQueryArgs(argv) {
  const args = argv.slice(2);
  const opts = { since: null, until: null, format: "text" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--since":
        opts.since = args[++i];
        break;
      case "--until":
        opts.until = args[++i];
        break;
      case "--format":
        opts.format = args[++i];
        if (!["text", "json", "md"].includes(opts.format)) {
          throw new Error(`Unknown format: ${opts.format}. Use text, json, or md.`);
        }
        break;
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  if (!opts.since || !opts.until) {
    throw new Error("--since and --until are required.");
  }

  const since = parseUserDateTimeInput(opts.since);
  const until = parseUserDateTimeInput(opts.until);
  if (!since || !until) {
    throw new Error("Invalid date format.");
  }

  return { ...opts, since, until };
}

export function formatQueryUsage() {
  return "Usage: node scripts/query-links.js --since <ISO8601> --until <ISO8601> [--format text|json|md]  (naive time input defaults to +08:00)";
}

export async function runQuery({ skillRoot, since, until, format = "text", indexPath } = {}) {
  const resolvedIndexPath =
    indexPath ??
    (process.env.WECHAT_FILEHELPER_INDEX_PATH
      ? path.resolve(process.env.WECHAT_FILEHELPER_INDEX_PATH)
      : path.join(skillRoot, "local/index/links.jsonl"));

  const all = await readJsonlines(resolvedIndexPath);
  if (all.length === 0) {
    return {
      records: [],
      uncertainLinks: [],
      pendingItems: [],
      skippedCards: [],
      rendered: "Index is empty. Run scan-links.js first.",
      indexPath: resolvedIndexPath,
    };
  }

  const seenUrls = new Set();
  const seenUncertain = new Set();
  const seenSkipped = new Set();
  const seenPending = new Set();
  const deduped = [];
  const uncertainLinks = [];
  const pendingItems = [];
  const skippedCards = [];

  for (const record of all) {
    if (!recordMatchesTimeRange(record, since, until)) continue;

    if (record?.record_type === "skipped_card") {
      const skippedKey = record.dedupe_key ?? `${record.message_time}|${record.skip_reason}|${record.title ?? ""}`;
      if (seenSkipped.has(skippedKey)) continue;
      seenSkipped.add(skippedKey);
      skippedCards.push(record);
      continue;
    }

    if (record?.record_type === "pending_item") {
      const pendingKey = record.dedupe_key ?? `${record.pending_reason}|${record.title ?? ""}|${record.raw_text ?? ""}`;
      if (seenPending.has(pendingKey)) continue;
      seenPending.add(pendingKey);
      pendingItems.push(record);
      continue;
    }

    if (record?.record_type === "uncertain_link") {
      if (!record?.url || shouldSkipUrl(record.url)) continue;
      if (seenUrls.has(record.url) || seenUncertain.has(record.url)) continue;
      seenUncertain.add(record.url);
      uncertainLinks.push(record);
      continue;
    }

    if (!record?.url || shouldSkipUrl(record.url)) continue;
    if (seenUrls.has(record.url)) continue;
    seenUrls.add(record.url);
    deduped.push(record);
  }

  const filteredUncertainLinks = uncertainLinks.filter((record) => !seenUrls.has(record.url));

  return {
    records: deduped,
    uncertainLinks: filteredUncertainLinks,
    pendingItems,
    skippedCards,
    rendered: renderQueryResults(
      { records: deduped, uncertainLinks: filteredUncertainLinks, pendingItems, skippedCards },
      { since, until, format }
    ),
    indexPath: resolvedIndexPath,
  };
}

function recordMatchesTimeRange(record, since, until) {
  if (record?.record_type === "pending_item") {
    const pendingSince = record?.pending_window_since ? new Date(record.pending_window_since) : null;
    const pendingUntil = record?.pending_window_until ? new Date(record.pending_window_until) : null;
    if (
      pendingSince instanceof Date &&
      !Number.isNaN(pendingSince.getTime()) &&
      pendingUntil instanceof Date &&
      !Number.isNaN(pendingUntil.getTime())
    ) {
      return pendingSince <= until && pendingUntil >= since;
    }
  }

  const t = new Date(record?.message_time);
  if (Number.isNaN(t.getTime())) return false;
  return t >= since && t <= until;
}

function formatDisplayTime(value) {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "(time unavailable)";
  }
  return formatCstDateTime(date);
}

export function renderQueryResults(
  { records, uncertainLinks = [], pendingItems = [], skippedCards = [] },
  { since, until, format }
) {
  if (records.length === 0 && uncertainLinks.length === 0 && pendingItems.length === 0 && skippedCards.length === 0) {
    return "No links found in the specified time range.";
  }

  switch (format) {
    case "json":
      return JSON.stringify(
        { records, uncertain_links: uncertainLinks, pending_items: pendingItems, skipped_cards: skippedCards },
        null,
        2
      );
    case "md": {
      const lines = [`# 文件传输助手链接（${formatCstDateTime(since)} ~ ${formatCstDateTime(until)}）`, ""];
      lines.push("## 已收集链接");
      lines.push("");
      if (records.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of records) {
          const title = record.title || record.url;
          lines.push(`- [${title}](${record.url})`);
          lines.push(`  > ${formatDisplayTime(record.message_time)}`);
        }
      }

      lines.push("");
      lines.push("## 待确认项");
      lines.push("");
      if (uncertainLinks.length === 0 && pendingItems.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of uncertainLinks) {
          const title = record.title || record.url;
          lines.push(`- [${title}](${record.url})`);
          lines.push(`  > ${formatDisplayTime(record.message_time)}`);
          lines.push(`  > ${record.confidence_reason ?? "ocr_uncertain"}`);
        }
        for (const record of pendingItems) {
          lines.push(`- ${record.title || "(untitled pending item)"}`);
          lines.push(`  > ${formatDisplayTime(record.message_time)}`);
          lines.push(`  > ${record.pending_reason ?? "pending"}`);
        }
      }

      lines.push("");
      lines.push("## 已跳过卡片");
      lines.push("");
      if (skippedCards.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of skippedCards) {
          lines.push(`- ${record.title || "(untitled skipped card)"}`);
          lines.push(`  > ${formatDisplayTime(record.message_time)}`);
          lines.push(`  > ${record.skip_reason ?? "skipped"}`);
        }
      }
      return lines.join("\n");
    }
    case "text":
    default: {
      const lines = [`Found ${records.length} link(s):`, ""];
      for (const record of records) {
        lines.push(`[${formatDisplayTime(record.message_time)}] ${record.title || "(no title)"}`);
        lines.push(`  ${record.url}`);
        lines.push("");
      }

      lines.push(`Pending ${uncertainLinks.length + pendingItems.length} item(s):`);
      lines.push("");
      for (const record of uncertainLinks) {
        lines.push(`[${formatDisplayTime(record.message_time)}] ${record.title || "(no title)"}`);
        lines.push(`  ${record.url}`);
        lines.push(`  confidence: ${record.confidence_reason ?? "ocr_uncertain"}`);
        lines.push("");
      }
      for (const record of pendingItems) {
        lines.push(`[${formatDisplayTime(record.message_time)}] ${record.title || "(untitled pending item)"}`);
        lines.push(`  pending: ${record.pending_reason ?? "pending"}`);
        lines.push("");
      }

      lines.push(`Skipped ${skippedCards.length} card(s):`);
      lines.push("");
      for (const record of skippedCards) {
        lines.push(`[${formatDisplayTime(record.message_time)}] ${record.title || "(untitled skipped card)"}`);
        lines.push(`  skip: ${record.skip_reason ?? "skipped"}`);
        lines.push("");
      }
      return lines.join("\n").trimEnd();
    }
  }
}
