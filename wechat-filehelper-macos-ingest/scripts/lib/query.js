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
      rendered: "Index is empty. Run scan-links.js first.",
      indexPath: resolvedIndexPath,
    };
  }

  const results = filterByTimeRange(all, since, until);
  const seen = new Set();
  const deduped = results.filter((record) => {
    if (!record?.url || shouldSkipUrl(record.url)) return false;
    if (seen.has(record.url)) return false;
    seen.add(record.url);
    return true;
  });

  return {
    records: deduped,
    rendered: renderQueryResults(deduped, { since, until, format }),
    indexPath: resolvedIndexPath,
  };
}

export function renderQueryResults(records, { since, until, format }) {
  if (records.length === 0) {
    return "No links found in the specified time range.";
  }

  switch (format) {
    case "json":
      return JSON.stringify(records, null, 2);
    case "md": {
      const lines = [`# 文件传输助手链接（${since.toISOString()} ~ ${until.toISOString()}）`, ""];
      for (const record of records) {
        const title = record.title || record.url;
        lines.push(`- [${title}](${record.url})`);
        lines.push(`  > ${record.message_time}`);
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
      return lines.join("\n").trimEnd();
    }
  }
}
