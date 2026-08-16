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

async function main() {
  if (process.platform !== "darwin") {
    throw new Error(`视频处理仅支持 macOS，当前平台为 ${process.platform}`);
  }

  const opts = parseVideoProcessArgs(process.argv);
  if (opts.help) {
    console.log(formatVideoProcessUsage());
    return;
  }

  const pending = await listPendingVideoRecords(opts.indexPath);
  if (pending.length === 0) {
    console.log("没有待处理的视频号记录。先运行 npm run collect 完成 UI 扫描。");
    return;
  }

  const outputDir = opts.outputDir || "";
  const vaultPath = outputDir
    ? ""
    : await resolveObsidianVaultPath({ vaultPath: opts.vaultPath, preferredName: opts.vaultName });
  const asrConfig = await resolveVideoAsrConfig({
    modelRoot: opts.modelRoot || undefined,
    modelId: opts.modelId,
    statusPath: opts.statusPath || undefined,
    v2tRoot: opts.v2tRoot || undefined,
    workerPath: opts.workerPath || undefined,
  });

  const selected = pending.slice(0, opts.limit);
  console.log(`待处理视频 ${pending.length} 条，本次处理 ${selected.length} 条。`);
  console.log(`ASR: ${asrConfig.modelId}`);
  console.log(`输出: ${outputDir || vaultPath}`);

  for (const record of selected) {
    if (!opts.noPrompt) await promptForVideo(record, opts.durationSeconds);

    let screenRect = null;
    try {
      screenRect = getFrontWeChatWindow();
    } catch {
      // ScreenCaptureKit will fall back to the main display when window bounds are unavailable.
    }

    const result = await processVideoRecord(record, {
      indexPath: opts.indexPath,
      durationSeconds: opts.durationSeconds,
      screenRect,
      modelConfig: asrConfig,
      workerPath: asrConfig.workerPath,
      modelId: asrConfig.modelId,
      summaryFn: ({ title, transcript }) =>
        summarizeTranscript({ title, transcript, baseUrl: opts.llmBaseUrl, model: opts.llmModel }),
      noteOptions: {
        vaultPath,
        outputDir,
        folder: opts.folder,
      },
    });

    if (result.error) {
      console.error(`处理失败：${record.title || "未命名视频"}`);
      console.error(`  ${result.error.code || "video_processing_failed"}: ${result.error.message}`);
      continue;
    }
    console.log(`已完成：${record.title || "未命名视频"}`);
    console.log(`  Note: ${result.notePath}`);
  }
}

async function promptForVideo(record, durationSeconds) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nFatal error: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  });
}
