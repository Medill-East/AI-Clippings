#!/usr/bin/env node
/**
 * collect-links.js — One-command entrypoint that scans and immediately prints
 * query results for the same time range.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatQueryUsage, runQuery } from "./lib/query.js";
import { formatScanUsage, parseScanArgs, runScan } from "./lib/scan.js";
import { runVideoBatch } from "./lib/video-channel-batch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseCollectArgs(argv) {
  const args = argv.slice(2);
  const scanArgs = [argv[0], argv[1]];
  let format = "md";
  let processVideos = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format") {
      format = args[i + 1];
      if (!["text", "json", "md"].includes(format)) {
        throw new Error(`Unknown format: ${format}. Use text, json, or md.`);
      }
      i += 1;
      continue;
    }

    if (args[i] === "--skip-videos") {
      processVideos = false;
      continue;
    }

    scanArgs.push(args[i]);
  }

  const scanOpts = parseScanArgs(scanArgs);
  return { ...scanOpts, format, processVideos };
}

function formatCollectUsage() {
  return [
    "Usage:",
    "  node scripts/collect-links.js --since <ISO8601> --until <ISO8601> [options]",
    "",
    "Options:",
    "  --source <mode>       auto | ui | store | clipboard (default auto)",
    "  --format <mode>       text | json | md (default md)",
    "  --max-scrolls N       Maximum upward scrolls for UI/clipboard scanning (default 50, max 200)",
    "  --reindex             Clear existing index before scan",
    "  --debug               Print verbose debug output",
    "  --skip-videos         Do not run background Video Channels processing",
  ].join("\n");
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("Error: 此 skill 仅支持 macOS。当前平台:", process.platform);
    process.exit(1);
  }

  let opts;
  try {
    opts = parseCollectArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error("");
    console.error(formatCollectUsage());
    console.error("");
    console.error(formatScanUsage());
    console.error(formatQueryUsage());
    process.exit(1);
  }

  const scanResult = await runScan(opts, { skillRoot });

  const queryResult = await runQuery({
    skillRoot,
    since: opts.since,
    until: opts.until,
    format: opts.format,
  });

  console.log("");
  if (
    scanResult.newRecords.length === 0 &&
    (scanResult.uncertainRecords?.length ?? 0) === 0 &&
    (scanResult.skippedRecords?.length ?? 0) === 0 &&
    (scanResult.unresolvedRecords?.length ?? 0) === 0 &&
    (scanResult.contentRecords?.length ?? 0) === 0 &&
    (
      queryResult.records.length > 0 ||
      (queryResult.videoChannels?.length ?? 0) > 0 ||
      (queryResult.uncertainLinks?.length ?? 0) > 0 ||
      (queryResult.skippedCards?.length ?? 0) > 0 ||
      (queryResult.imageContents?.length ?? 0) > 0 ||
      (queryResult.unresolvedItems?.length ?? 0) > 0
    )
  ) {
    console.log("本次扫描没有新增链接；下面展示的是该时间范围内已有索引中的结果。");
    console.log("");
  }
  console.log(queryResult.rendered);

  if (opts.processVideos) {
    const videoResult = await runVideoBatch(
      {
        skillRoot,
        since: opts.since,
        until: opts.until,
      },
      {
        onEvent: (event) => {
          const prefix = `[video ${event.index}/${event.total}]`;
          if (event.type === "task_state") {
            console.log(`${prefix} ${event.state}`);
          } else if (event.type === "asr_progress") {
            console.log(`${prefix} ASR ${event.current}/${event.chunks}`);
          } else if (event.type === "task_finished" && event.state === "failed") {
            console.log(`${prefix} failed: ${event.errorCode}`);
          } else if (event.type === "batch_blocked_auth") {
            console.log(
              `视频号需要重新登录元宝；其余 ${event.notAttempted} 条未尝试。请先运行：${event.recoveryCommand}`,
            );
          }
        },
      },
    );
    if (videoResult.counts.selected > 0) {
      console.log("");
      console.log(
        `视频号后台处理：written=${videoResult.counts.written}，skipped=${videoResult.counts.skipped}，failed=${videoResult.counts.failed}，not_attempted=${videoResult.counts.not_attempted}`,
      );
      console.log(`视频号 manifest：${videoResult.manifestPath}`);
    }
    if (videoResult.counts.failed > 0) process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
