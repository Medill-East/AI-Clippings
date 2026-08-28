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
      videoChannels: [],
      uncertainLinks: [],
      skippedCards: [],
      imageContents: [],
      unresolvedItems: [],
      rendered: "Index is empty. Run scan-links.js first.",
      indexPath: resolvedIndexPath,
    };
  }

  const results = filterByTimeRange(all, since, until);
  const seenUrls = new Set();
  const seenUncertain = new Set();
  const seenSkipped = new Set();
  const seenVideos = new Set();
  const seenImageContents = new Set();
  const seenUnresolvedItems = new Set();
  const deduped = [];
  const uncertainLinks = [];
  const skippedCards = [];
  const videoChannels = [];
  const imageContents = [];
  const unresolvedItems = [];

  for (const record of results) {
    if (record?.record_type === "content" && record?.content_type === "image_ocr") {
      const imageKey = record.dedupe_key ?? `${record.message_time}|${record.content_hash}`;
      if (seenImageContents.has(imageKey)) continue;
      seenImageContents.add(imageKey);
      imageContents.push(record);
      continue;
    }

    if (record?.record_type === "unresolved_item") {
      const unresolvedKey =
        record.dedupe_key ??
        `${record.message_time}|${record.content_type}|${record.error_code}|${record.title ?? ""}`;
      if (seenUnresolvedItems.has(unresolvedKey)) continue;
      seenUnresolvedItems.add(unresolvedKey);
      unresolvedItems.push(record);
      continue;
    }

    if (record?.record_type === "skipped_card") {
      const skippedKey = record.dedupe_key ?? `${record.message_time}|${record.skip_reason}|${record.title ?? ""}`;
      if (seenSkipped.has(skippedKey)) continue;
      seenSkipped.add(skippedKey);
      skippedCards.push(record);
      continue;
    }

    if (record?.record_type === "uncertain_link") {
      if (!record?.url || shouldSkipUrl(record.url)) continue;
      if (seenUrls.has(record.url) || seenUncertain.has(record.url)) continue;
      seenUncertain.add(record.url);
      uncertainLinks.push(record);
      continue;
    }

    if (isVideoChannelShareUrl(record?.url)) {
      if (seenVideos.has(record.url)) continue;
      seenVideos.add(record.url);
      videoChannels.push(record);
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
    videoChannels,
    uncertainLinks: filteredUncertainLinks,
    skippedCards,
    imageContents,
    unresolvedItems,
    rendered: renderQueryResults(
      {
        records: deduped,
        videoChannels,
        uncertainLinks: filteredUncertainLinks,
        skippedCards,
        imageContents,
        unresolvedItems,
      },
      { since, until, format }
    ),
    indexPath: resolvedIndexPath,
  };
}

export function renderQueryResults(
  {
    records,
    videoChannels = [],
    uncertainLinks = [],
    skippedCards = [],
    imageContents = [],
    unresolvedItems = [],
  },
  { since, until, format },
) {
  if (
    records.length === 0 &&
    videoChannels.length === 0 &&
    uncertainLinks.length === 0 &&
    skippedCards.length === 0 &&
    imageContents.length === 0 &&
    unresolvedItems.length === 0
  ) {
    return "No items found in the specified time range.";
  }

  switch (format) {
    case "json":
      return JSON.stringify(
        {
          records,
          video_channels: videoChannels,
          uncertain_links: uncertainLinks,
          skipped_cards: skippedCards,
          image_contents: imageContents,
          unresolved_items: unresolvedItems,
        },
        null,
        2,
      );
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

      lines.push("");
      lines.push("## 视频号（后台处理）");
      lines.push("");
      if (videoChannels.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of videoChannels) {
          const title = record.title || record.url;
          lines.push(`- [${title}](${record.url})`);
          lines.push(`  > ${record.message_time}`);
        }
      }

      lines.push("");
      lines.push("## 待确认外链");
      lines.push("");
      if (uncertainLinks.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of uncertainLinks) {
          const title = record.title || record.url;
          lines.push(`- [${title}](${record.url})`);
          lines.push(`  > ${record.message_time}`);
          lines.push(`  > ${record.confidence_reason ?? "ocr_uncertain"}`);
        }
      }

      lines.push("");
      lines.push("## 图片 OCR 内容");
      lines.push("");
      if (imageContents.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of imageContents) {
          lines.push(`- ${record.title || "(untitled image)"}`);
          lines.push(`  > ${record.message_time}`);
          lines.push(`  > PKM: ${record.pkm_status ?? "unknown"}; OCR: ${record.ocr_confidence ?? "unknown"}`);
          if (record.note_path) lines.push(`  > ${record.note_path}`);
          const preview = String(record.content_text ?? "").split(/\r?\n/).find(Boolean);
          if (preview) lines.push(`  > ${preview}`);
        }
      }

      lines.push("");
      lines.push("## 未解决项");
      lines.push("");
      if (unresolvedItems.length === 0) {
        lines.push("- 无");
      } else {
        for (const record of unresolvedItems) {
          lines.push(`- ${record.title || "(untitled unresolved item)"}`);
          lines.push(`  > ${record.message_time}`);
          lines.push(`  > ${record.content_type ?? "unknown"} / ${record.failure_stage ?? "unknown"} / ${record.error_code ?? "unknown"}`);
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

      lines.push(`Video Channels ${videoChannels.length} background task(s):`);
      lines.push("");
      for (const record of videoChannels) {
        lines.push(`[${record.message_time}] ${record.title || "(no title)"}`);
        lines.push(`  ${record.url}`);
        lines.push("");
      }

      lines.push(`Uncertain ${uncertainLinks.length} external link(s):`);
      lines.push("");
      for (const record of uncertainLinks) {
        lines.push(`[${record.message_time}] ${record.title || "(no title)"}`);
        lines.push(`  ${record.url}`);
        lines.push(`  confidence: ${record.confidence_reason ?? "ocr_uncertain"}`);
        lines.push("");
      }

      lines.push(`Skipped ${skippedCards.length} card(s):`);
      lines.push("");
      for (const record of skippedCards) {
        lines.push(`[${record.message_time}] ${record.title || "(untitled skipped card)"}`);
        lines.push(`  skip: ${record.skip_reason ?? "skipped"}`);
        lines.push("");
      }

      lines.push(`Image OCR ${imageContents.length} content item(s):`);
      lines.push("");
      for (const record of imageContents) {
        lines.push(`[${record.message_time}] ${record.title || "(untitled image)"}`);
        lines.push(`  PKM: ${record.pkm_status ?? "unknown"}; OCR: ${record.ocr_confidence ?? "unknown"}`);
        if (record.note_path) lines.push(`  ${record.note_path}`);
        lines.push("");
      }

      lines.push(`Unresolved ${unresolvedItems.length} item(s):`);
      lines.push("");
      for (const record of unresolvedItems) {
        lines.push(`[${record.message_time}] ${record.title || "(untitled unresolved item)"}`);
        lines.push(`  ${record.content_type ?? "unknown"} / ${record.failure_stage ?? "unknown"} / ${record.error_code ?? "unknown"}`);
        lines.push("");
      }
      return lines.join("\n").trimEnd();
    }
  }
}

function isVideoChannelShareUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      ["weixin.qq.com", "www.weixin.qq.com"].includes(
        parsed.hostname.toLowerCase(),
      ) && /^\/sph\/[A-Za-z0-9]+\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
