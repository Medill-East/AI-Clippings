#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

import { getFrontWeChatWindow } from "./lib/applescript.js";
import {
  listPendingVideoRecords,
  processVideoRecord,
  resolveObsidianVaultPath,
  resolveVideoAsrConfig,
  summarizeTranscript,
} from "./lib/video-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

export function parseVideoProcessArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    indexPath: process.env.WECHAT_FILEHELPER_INDEX_PATH || path.join(skillRoot, "local/index/links.jsonl"),
    durationSeconds: 120,
    limit: 1,
    noPrompt: false,
    outputDir: "",
    vaultPath: "",
    vaultName: "",
    folder: process.env.OBSIDIAN_VIDEO_FOLDER || "Video Clips",
    modelId: process.env.VIDEO_ASR_MODEL || "qwen3-asr-0.6b",
    modelRoot: process.env.V2T_MODEL_ROOT || "",
    statusPath: process.env.V2T_MODEL_STATUS_PATH || "",
    v2tRoot: process.env.V2T_ROOT || "",
    workerPath: process.env.V2T_ASR_WORKER_PATH || "",
    llmBaseUrl: process.env.VIDEO_LLM_BASE_URL || "http://127.0.0.1:11434/v1",
    llmModel: process.env.VIDEO_LLM_MODEL || "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--duration":
        opts.durationSeconds = parsePositiveNumber(args[++index], "--duration", 3600);
        break;
      case "--limit":
        opts.limit = Math.max(1, parseInt(args[++index], 10));
        break;
      case "--all":
        opts.limit = Number.POSITIVE_INFINITY;
        break;
      case "--no-prompt":
        opts.noPrompt = true;
        break;
      case "--index-path":
        opts.indexPath = path.resolve(args[++index]);
        break;
      case "--output-dir":
        opts.outputDir = path.resolve(args[++index]);
        break;
      case "--vault-path":
        opts.vaultPath = args[++index];
        break;
      case "--vault-name":
        opts.vaultName = args[++index];
        break;
      case "--folder":
        opts.folder = args[++index];
        break;
      case "--model-id":
        opts.modelId = args[++index];
        break;
      case "--model-root":
        opts.modelRoot = args[++index];
        break;
      case "--status-path":
        opts.statusPath = args[++index];
        break;
      case "--v2t-root":
        opts.v2tRoot = args[++index];
        break;
      case "--worker-path":
        opts.workerPath = args[++index];
        break;
      case "--llm-base-url":
        opts.llmBaseUrl = args[++index];
        break;
      case "--llm-model":
        opts.llmModel = args[++index];
        break;
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return opts;
}

export function formatVideoProcessUsage() {
  return [
    "Usage:",
    "  npm run process:videos -- [options]",
    "",
    "Options:",
    "  --duration N       捕获 N 秒系统音频（默认 120，最大 3600）",
    "  --limit N          最多处理 N 条 pending 视频（默认 1）",
    "  --all              处理所有 pending 视频",
    "  --no-prompt        不等待 Enter，适合已准备好播放窗口的脚本调用",
    "  --output-dir DIR   直接把 Markdown 写入 DIR，不解析 Obsidian vault",
    "  --vault-path DIR   指定 Obsidian vault",
    "  --folder NAME      vault 内的视频笔记目录（默认 Video Clips）",
    "  --llm-base-url URL 本地 OpenAI-compatible 摘要服务（默认探测 Ollama）",
    "  --llm-model NAME   可选，本地摘要模型名；不填时自动选择服务中的第一个模型",
    "  --help             显示帮助",
  ].join("\n");
}

export async function processPendingVideos({
  indexPath,
  records = null,
  durationSeconds = 120,
  limit = 1,
  noPrompt = false,
  outputDir = "",
  vaultPath = "",
  vaultName = "",
  folder = process.env.OBSIDIAN_VIDEO_FOLDER || "Video Clips",
  modelId = process.env.VIDEO_ASR_MODEL || "qwen3-asr-0.6b",
  modelRoot = process.env.V2T_MODEL_ROOT || "",
  statusPath = process.env.V2T_MODEL_STATUS_PATH || "",
  v2tRoot = process.env.V2T_ROOT || "",
  workerPath = process.env.V2T_ASR_WORKER_PATH || "",
  llmBaseUrl = process.env.VIDEO_LLM_BASE_URL || "http://127.0.0.1:11434/v1",
  llmModel = process.env.VIDEO_LLM_MODEL || "",
  listPendingFn = listPendingVideoRecords,
  resolveVaultFn = resolveObsidianVaultPath,
  resolveAsrFn = resolveVideoAsrConfig,
  processRecordFn = processVideoRecord,
  getWindowFn = getFrontWeChatWindow,
  promptFn = promptForVideo,
  log = console,
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error(`视频处理仅支持 macOS，当前平台为 ${process.platform}`);
  }
  if (!indexPath) throw new Error("视频处理缺少 indexPath");

  const pending = records ?? (await listPendingFn(indexPath));
  if (pending.length === 0) {
    log.log("没有待处理的视频号记录。");
    return { pendingCount: 0, selectedCount: 0, resolvedCount: 0, failedCount: 0, results: [] };
  }

  const resolvedVaultPath = outputDir
    ? ""
    : await resolveVaultFn({ vaultPath, preferredName: vaultName });
  const asrConfig = await resolveAsrFn({
    modelRoot: modelRoot || undefined,
    modelId,
    statusPath: statusPath || undefined,
    v2tRoot: v2tRoot || undefined,
    workerPath: workerPath || undefined,
  });

  const selected = pending.slice(0, limit);
  log.log(`待处理视频 ${pending.length} 条，本次处理 ${selected.length} 条。`);
  log.log(`ASR: ${asrConfig.modelId}`);
  log.log(`输出: ${outputDir || resolvedVaultPath}`);
  const results = [];

  for (const record of selected) {
    if (!noPrompt) await promptFn(record, durationSeconds);

    let screenRect = null;
    try {
      screenRect = getWindowFn();
    } catch {
      // ScreenCaptureKit will fall back to the main display when window bounds are unavailable.
    }

    const result = await processRecordFn(record, {
      indexPath,
      durationSeconds,
      screenRect,
      modelConfig: asrConfig,
      workerPath: asrConfig.workerPath,
      modelId: asrConfig.modelId,
      summaryFn: ({ title, transcript }) =>
        summarizeTranscript({ title, transcript, baseUrl: llmBaseUrl, model: llmModel }),
      noteOptions: {
        vaultPath: resolvedVaultPath,
        outputDir,
        folder,
      },
    });
    results.push(result);

    if (result.error) {
      log.error(`处理失败：${record.title || "未命名视频"}`);
      log.error(`  ${result.error.code || "video_processing_failed"}: ${result.error.message}`);
      continue;
    }
    log.log(`已完成：${record.title || "未命名视频"}`);
    log.log(`  Note: ${result.notePath}`);
  }

  return {
    pendingCount: pending.length,
    selectedCount: selected.length,
    resolvedCount: results.filter((result) => !result.error).length,
    failedCount: results.filter((result) => result.error).length,
    results,
  };
}

export async function promptForVideo(record, durationSeconds) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("当前终端不是交互终端；请使用 --no-prompt，或在终端中运行此命令。\n" + formatVideoProcessUsage());
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question(
      `请在微信中打开并准备播放「${record.title || "未命名视频"}」。按 Enter 开始捕获，随后立即播放（${durationSeconds} 秒）：`
    );
  } finally {
    prompt.close();
  }
}

function parsePositiveNumber(value, flag, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${flag} 必须是 0 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error(`视频处理仅支持 macOS，当前平台为 ${process.platform}`);
  }

  const opts = parseVideoProcessArgs(process.argv);
  if (opts.help) {
    console.log(formatVideoProcessUsage());
    return;
  }

  await processPendingVideos({
    indexPath: opts.indexPath,
    durationSeconds: opts.durationSeconds,
    limit: opts.limit,
    noPrompt: opts.noPrompt,
    outputDir: opts.outputDir,
    vaultPath: opts.vaultPath,
    vaultName: opts.vaultName,
    folder: opts.folder,
    modelId: opts.modelId,
    modelRoot: opts.modelRoot,
    statusPath: opts.statusPath,
    v2tRoot: opts.v2tRoot,
    workerPath: opts.workerPath,
    llmBaseUrl: opts.llmBaseUrl,
    llmModel: opts.llmModel,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nFatal error: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  });
}
