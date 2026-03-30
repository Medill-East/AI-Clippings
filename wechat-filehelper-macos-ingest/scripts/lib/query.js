import path from "node:path";

import { filterByTimeRange, readJsonlines, shouldSkipUrl } from "./common.js";

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

  const since = new Date(opts.since);
  const until = new Date(opts.until);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("Invalid date format.");
  }

  return { ...opts, since, until };
}

export function formatQueryUsage() {
  return "Usage: node scripts/query-links.js --since <ISO8601> --until <ISO8601> [--format text|json|md]";
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
      skippedCards: [],
      rendered: "Index is empty. Run scan-links.js first.",
      indexPath: resolvedIndexPath,
    };
  }

  const results = filterByTimeRange(all, since, until);
  const seenUrls = new Set();
  const seenSkipped = new Set();
  const deduped = [];
  const skippedCards = [];

  for (const record of results) {
    if (record?.record_type === "skipped_card") {
      const skippedKey = record.dedupe_key ?? `${record.message_time}|${record.skip_reason}|${record.title ?? ""}`;
      if (seenSkipped.has(skippedKey)) continue;
      seenSkipped.add(skippedKey);
      skippedCards.push(record);
      continue;
    }

    if (!record?.url || shouldSkipUrl(record.url)) continue;
    if (seenUrls.has(record.url)) continue;
    seenUrls.add(record.url);
    deduped.push(record);
  }

  return {
    records: deduped,
    skippedCards,
    rendered: renderQueryResults({ records: deduped, skippedCards }, { since, until, format }),
    indexPath: resolvedIndexPath,
  };
}

export function renderQueryResults({ records, skippedCards = [] }, { since, until, format }) {
  if (records.length === 0 && skippedCards.length === 0) {
    return "No links found in the specified time range.";
  }

  switch (format) {
    case "json":
      return JSON.stringify({ records, skipped_cards: skippedCards }, null, 2);
    case "md": {
      const lines = [`# 文件传输助手链接（${since.toISOString()} ~ ${until.toISOString()}）`, ""];
      lines.push("## 已收集链接");
      lines.push("");
      if (records.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of records) {
          const title = record.title || record.url;
          lines.push(`- [${title}](${record.url})`);
          lines.push(`  > ${record.message_time}`);
        }
      }

      if (skippedCards.length > 0) {
        lines.push("");
        lines.push("## 已跳过卡片");
        lines.push("");
        for (const record of skippedCards) {
          lines.push(`- ${record.title || "(untitled skipped card)"}`);
          lines.push(`  > ${record.message_time}`);
          lines.push(`  > ${record.skip_reason ?? "skipped"}`);
        }
      }
      return lines.join("\n");
    }
    case "text":
    default: {
      const lines = [`Found ${records.length} link(s):`, ""];
      for (const record of records) {
        lines.push(`[${record.message_time}] ${record.title || "(no title)"}`);
        lines.push(`  ${record.url}`);
        lines.push("");
      }

      if (skippedCards.length > 0) {
        lines.push(`Skipped ${skippedCards.length} card(s):`);
        lines.push("");
        for (const record of skippedCards) {
          lines.push(`[${record.message_time}] ${record.title || "(untitled skipped card)"}`);
          lines.push(`  skip: ${record.skip_reason ?? "skipped"}`);
          lines.push("");
        }
      }
      return lines.join("\n").trimEnd();
    }
  }
}
