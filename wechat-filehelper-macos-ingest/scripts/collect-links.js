#!/usr/bin/env node
/**
 * collect-links.js — One-command entrypoint that scans and immediately prints
 * query results for the same time range.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

import { formatQueryUsage, runQuery } from "./lib/query.js";
import { formatScanUsage, parseScanArgs, runScan } from "./lib/scan.js";
import { listPendingVideoRecords } from "./lib/video-pipeline.js";
import { processPendingVideos } from "./process-videos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

export function parseCollectArgs(argv) {
  const args = argv.slice(2);
  const scanArgs = [argv[0], argv[1]];
  let format = "md";
  const videoOptions = {
    processVideos: true,
    videoDurationSeconds: 120,
    videoLimit: Number.POSITIVE_INFINITY,
    videoNoPrompt: false,
    videoOutputDir: "",
    videoVaultPath: "",
    videoVaultName: "",
    videoFolder: process.env.OBSIDIAN_VIDEO_FOLDER || "Video Clips",
    videoModelId: process.env.VIDEO_ASR_MODEL || "qwen3-asr-0.6b",
    videoLlmBaseUrl: process.env.VIDEO_LLM_BASE_URL || "http://127.0.0.1:11434/v1",
    videoLlmModel: process.env.VIDEO_LLM_MODEL || "",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--format":
        format = args[i + 1];
        if (!["text", "json", "md"].includes(format)) {
          throw new Error(`Unknown format: ${format}. Use text, json, or md.`);
        }
        i += 1;
        break;
      case "--skip-video-processing":
        videoOptions.processVideos = false;
        break;
      case "--video-duration":
        videoOptions.videoDurationSeconds = parsePositiveNumber(args[++i], "--video-duration", 3600);
        break;
      case "--video-limit":
        videoOptions.videoLimit = parsePositiveInteger(args[++i], "--video-limit");
        break;
      case "--video-no-prompt":
        videoOptions.videoNoPrompt = true;
        break;
      case "--video-output-dir":
        videoOptions.videoOutputDir = path.resolve(args[++i]);
        break;
      case "--video-vault-path":
        videoOptions.videoVaultPath = args[++i];
        break;
      case "--video-vault-name":
        videoOptions.videoVaultName = args[++i];
        break;
      case "--video-folder":
        videoOptions.videoFolder = args[++i];
        break;
      case "--video-model-id":
        videoOptions.videoModelId = args[++i];
        break;
      case "--video-llm-base-url":
        videoOptions.videoLlmBaseUrl = args[++i];
        break;
      case "--video-llm-model":
        videoOptions.videoLlmModel = args[++i];
        break;
      default:
        scanArgs.push(args[i]);
        break;
    }
  }

  const scanOpts = parseScanArgs(scanArgs);
  return { ...scanOpts, format, ...videoOptions };
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
    "  --skip-video-processing  Only record video cards; do not process them in this run",
    "  --video-duration N    Capture N seconds for each video card (default 120)",
    "  --video-no-prompt     Start video capture without waiting for Enter",
  ].join("\n");
}

export async function runCollect(
  opts,
  {
    skillRoot: rootOverride = skillRoot,
    runScanFn = runScan,
    runQueryFn = runQuery,
    listPendingVideoRecordsFn = listPendingVideoRecords,
    processPendingVideosFn = processPendingVideos,
    confirmVideoProcessingFn = confirmVideoProcessing,
    log = console,
  } = {}
) {
  const root = rootOverride;
  const scanResult = await runScanFn(opts, { skillRoot: root });

  const videoKeys = new Set(
    (scanResult.pendingRecords ?? [])
      .filter((record) => record?.content_type === "video" && record?.dedupe_key)
      .map((record) => record.dedupe_key)
  );

  let queryResult = await runQueryFn({
    skillRoot: root,
    since: opts.since,
    until: opts.until,
    format: opts.format,
  });

  printCollectQueryResult({ log, scanResult, queryResult });

  let videoProcessResult = null;
  if (opts.processVideos && videoKeys.size > 0) {
    const indexPath = path.join(root, "local/index/links.jsonl");
    const indexedPendingVideos = await listPendingVideoRecordsFn(indexPath);
    const currentPendingVideos = indexedPendingVideos.filter((record) => videoKeys.has(record.dedupe_key));
    if (currentPendingVideos.length > 0) {
      const shouldProcess = opts.videoNoPrompt || (await confirmVideoProcessingFn(currentPendingVideos.length));
      if (!shouldProcess) {
        log.log("已跳过视频处理，视频卡片保留在 pending 队列。\n");
        videoProcessResult = { skipped: true, pendingCount: currentPendingVideos.length };
      } else {
        log.log("");
        log.log(`开始处理 ${currentPendingVideos.length} 条视频内容。`);
        try {
          videoProcessResult = await processPendingVideosFn({
            indexPath,
            records: currentPendingVideos,
            durationSeconds: opts.videoDurationSeconds,
            limit: opts.videoLimit,
            noPrompt: opts.videoNoPrompt,
            outputDir: opts.videoOutputDir,
            vaultPath: opts.videoVaultPath,
            vaultName: opts.videoVaultName,
            folder: opts.videoFolder,
            modelId: opts.videoModelId,
            llmBaseUrl: opts.videoLlmBaseUrl,
            llmModel: opts.videoLlmModel,
            log,
          });
        } catch (error) {
          log.error(`视频分支暂未执行：${error.message}`);
          log.error("视频卡片已保留在 pending 队列，可稍后重试。\n");
          videoProcessResult = { error };
        }
      }
    }
  }

  if (videoProcessResult && !videoProcessResult.skipped && !videoProcessResult.error) {
    queryResult = await runQueryFn({
      skillRoot: root,
      since: opts.since,
      until: opts.until,
      format: opts.format,
    });
    log.log("");
    log.log("视频处理完成，下面是更新后的索引结果：");
    log.log(queryResult.rendered);
  }
  return { scanResult, videoProcessResult, queryResult };
}

export async function confirmVideoProcessing(videoCount, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) return false;
  const prompt = readline.createInterface({ input, output });
  try {
    const answer = await prompt.question(
      `已输出文章和文本链接。请先交给另一个 AI 处理；准备好后按 Enter 继续处理 ${videoCount} 条视频，输入 n 跳过：`
    );
    return !/^\s*n(?:o)?\s*$/i.test(answer);
  } finally {
    prompt.close();
  }
}

function printCollectQueryResult({ log, scanResult, queryResult }) {
  log.log("");
  if (
    (scanResult.newRecords?.length ?? 0) === 0 &&
    (scanResult.uncertainRecords?.length ?? 0) === 0 &&
    (scanResult.pendingRecords?.length ?? 0) === 0 &&
    (scanResult.skippedRecords?.length ?? 0) === 0 &&
    (
      queryResult.records.length > 0 ||
      (queryResult.uncertainLinks?.length ?? 0) > 0 ||
      (queryResult.pendingItems?.length ?? 0) > 0 ||
      (queryResult.videos?.length ?? 0) > 0 ||
      (queryResult.skippedCards?.length ?? 0) > 0
    )
  ) {
    log.log("本次扫描没有新增链接；下面展示的是该时间范围内已有索引中的结果。");
    log.log("");
  }
  log.log(queryResult.rendered);
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

  await runCollect(opts, { skillRoot });
}

function parsePositiveNumber(value, flag, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${flag} 必须是 0 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} 必须是正整数。`);
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("\nFatal error:", err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}
