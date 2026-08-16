import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readJsonlines, writeJsonlines } from "./common.js";
import { captureSystemAudioToWav } from "./video-capture.js";
import {
  resolveV2tModelConfig,
  resolveV2tWorkerPath,
  transcribeWavWithV2t,
} from "./video.js";

const DEFAULT_OBSIDIAN_CONFIG_PATHS = [
  path.join(os.homedir(), "Library/Application Support/obsidian/obsidian.json"),
  path.join(os.homedir(), "Library/Application Support/Obsidian/obsidian.json"),
];

export async function listPendingVideoRecords(indexPath) {
  const records = await readJsonlines(indexPath);
  return records
    .filter(
      (record) =>
        record?.content_type === "video" &&
        record?.record_type === "pending_item" &&
        ["pending", "failed", "processing"].includes(record?.video_status ?? "pending")
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.message_time || left.captured_at || "") || 0;
      const rightTime = Date.parse(right.message_time || right.captured_at || "") || 0;
      return leftTime - rightTime;
    });
}

export async function replaceVideoRecord(indexPath, dedupeKey, patch) {
  const records = await readJsonlines(indexPath);
  const index = records.findIndex((record) => record?.dedupe_key === dedupeKey);
  if (index < 0) {
    throw createVideoPipelineError(`找不到待处理视频记录: ${dedupeKey}`, "video_record_missing");
  }
  const updated = { ...records[index], ...patch };
  records[index] = updated;
  await writeJsonlines(indexPath, records);
  return updated;
}

export async function resolveObsidianVaultPath({
  configPath = process.env.OBSIDIAN_CONFIG_PATH || "",
  vaultPath = process.env.OBSIDIAN_VAULT_PATH || "",
  preferredName = process.env.OBSIDIAN_VAULT_NAME || "",
  configPaths = DEFAULT_OBSIDIAN_CONFIG_PATHS,
} = {}) {
  if (vaultPath) {
    const resolved = expandHome(vaultPath);
    if (!existsSync(resolved)) {
      throw createVideoPipelineError(`Obsidian vault 不存在: ${resolved}`, "obsidian_vault_missing");
    }
    return resolved;
  }

  const candidates = [configPath, ...configPaths].filter(Boolean);
  let config;
  let selectedConfigPath = "";
  for (const candidate of candidates) {
    try {
      config = JSON.parse(await fs.readFile(expandHome(candidate), "utf8"));
      selectedConfigPath = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw createVideoPipelineError(`无法读取 Obsidian 配置: ${candidate}`, "obsidian_config_unreadable", error);
      }
    }
  }

  if (!config?.vaults || typeof config.vaults !== "object") {
    throw createVideoPipelineError(
      `未找到可用的 Obsidian vault 配置${selectedConfigPath ? `: ${selectedConfigPath}` : ""}`,
      "obsidian_vault_not_found"
    );
  }

  const entries = Object.values(config.vaults)
    .filter((vault) => vault?.path && existsSync(expandHome(vault.path)))
    .sort((left, right) => Number(Boolean(right.open)) - Number(Boolean(left.open)) || (right.ts ?? 0) - (left.ts ?? 0));
  const preferred = preferredName
    ? entries.find((vault) => path.basename(expandHome(vault.path)) === preferredName)
    : null;
  const selected = preferred ?? entries[0];
  if (!selected) {
    throw createVideoPipelineError("Obsidian 配置中没有存在的 vault。", "obsidian_vault_not_found");
  }
  return expandHome(selected.path);
}

export async function writeVideoNote({
  vaultPath,
  outputDir = "",
  folder = process.env.OBSIDIAN_VIDEO_FOLDER || "Video Clips",
  title = "未命名视频",
  provider = "wechat_channels",
  messageTime = null,
  capturedAt = new Date().toISOString(),
  sourceUrl = null,
  asrModel = "",
  summary = "",
  summaryMethod = "heuristic",
  transcript = "",
} = {}) {
  const baseDirectory = outputDir ? expandHome(outputDir) : vaultPath ? path.join(vaultPath, folder) : "";
  if (!baseDirectory) {
    throw createVideoPipelineError("没有配置 Obsidian vault 或视频笔记输出目录。", "video_note_output_missing");
  }
  await fs.mkdir(baseDirectory, { recursive: true });

  const timestamp = formatFileTimestamp(messageTime || capturedAt);
  const displayTitle = String(title || "未命名视频").replace(/\s+/g, " ").trim() || "未命名视频";
  const safeTitle = sanitizeFilename(displayTitle) || "未命名视频";
  const baseName = `${timestamp} ${safeTitle}`.trim().slice(0, 160);
  let notePath = path.join(baseDirectory, `${baseName}.md`);
  let suffix = 2;
  while (existsSync(notePath)) {
    notePath = path.join(baseDirectory, `${baseName} (${suffix}).md`);
    suffix += 1;
  }

  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    "content_type: video",
    `provider: ${yamlString(provider)}`,
    "video_status: resolved",
    `message_time: ${yamlString(messageTime)}`,
    `captured_at: ${yamlString(capturedAt)}`,
    `summary_method: ${yamlString(summaryMethod)}`,
    `asr_model: ${yamlString(asrModel)}`,
  ];
  if (sourceUrl) lines.push(`source_url: ${yamlString(sourceUrl)}`);
  lines.push("---", "", `# ${displayTitle}`, "", "## 摘要", "", summary.trim() || "- 未生成摘要", "", "## 转录", "", transcript.trim() || "（没有识别到语音内容）", "");

  await fs.writeFile(notePath, lines.join("\n"), "utf8");
  return notePath;
}

export async function summarizeTranscript({
  title = "",
  transcript = "",
  baseUrl = process.env.VIDEO_LLM_BASE_URL || "",
  model = process.env.VIDEO_LLM_MODEL || "",
  apiKey = process.env.VIDEO_LLM_API_KEY || "",
  timeoutMs = 60_000,
  fetchFn = globalThis.fetch,
} = {}) {
  const fallback = buildHeuristicSummary(transcript);
  if (!baseUrl || typeof fetchFn !== "function") {
    return { summary: fallback, method: "heuristic", fallback_reason: "local_llm_not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
    const resolvedModel = model || (await discoverLocalLlmModel(normalizedBaseUrl, fetchFn, controller.signal, apiKey));
    const response = await fetchFn(`${normalizedBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: resolvedModel || "default",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是个人知识库整理助手。请用中文总结视频转录，输出一段简洁摘要和 3-6 条要点，不要编造转录中没有的事实。",
          },
          {
            role: "user",
            content: `标题：${title || "未命名视频"}\n\n转录：\n${String(transcript).slice(0, 60_000)}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw createVideoPipelineError(`本地 LLM 返回 HTTP ${response.status}`, "video_llm_http_error");
    const body = await response.json();
    const summary = body?.choices?.[0]?.message?.content?.trim();
    if (!summary) throw createVideoPipelineError("本地 LLM 返回空摘要", "video_llm_empty");
    return { summary, method: "local_llm" };
  } catch (error) {
    return {
      summary: fallback,
      method: "heuristic",
      fallback_reason: error?.name === "AbortError" ? "local_llm_timeout" : error?.code || "local_llm_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverLocalLlmModel(baseUrl, fetchFn, signal, apiKey) {
  const response = await fetchFn(`${baseUrl}/models`, {
    signal,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) throw createVideoPipelineError(`本地 LLM 模型列表返回 HTTP ${response.status}`, "video_llm_models_http_error");
  const body = await response.json();
  return body?.data?.[0]?.id || body?.models?.[0]?.name || "default";
}

export function buildHeuristicSummary(transcript) {
  const clean = String(transcript ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "- 未识别到可用语音内容";

  const sentences = clean
    .split(/(?<=[。！？!?；;])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const selected = (sentences.length > 0 ? sentences : [clean]).slice(0, 5);
  return selected.map((sentence) => `- ${sentence.slice(0, 240)}`).join("\n");
}

export async function processVideoRecord(
  record,
  {
    indexPath,
    durationSeconds = 120,
    screenRect = null,
    captureFn = captureSystemAudioToWav,
    transcribeFn = transcribeWavWithV2t,
    modelConfig = null,
    workerPath = "",
    modelId = "",
    summaryFn = summarizeTranscript,
    noteFn = writeVideoNote,
    noteOptions = {},
    captureOptions = {},
    transcribeOptions = {},
  } = {}
) {
  if (!record?.dedupe_key) {
    throw createVideoPipelineError("视频记录缺少 dedupe_key。", "video_record_invalid");
  }
  if (!indexPath) {
    throw createVideoPipelineError("视频处理缺少 indexPath。", "video_index_missing");
  }

  await replaceVideoRecord(indexPath, record.dedupe_key, {
    record_type: "pending_item",
    video_status: "processing",
    processing_started_at: new Date().toISOString(),
    video_error: null,
    video_error_code: null,
  });

  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "wechat-filehelper-video-asr-"));
  const wavPath = path.join(temporaryDir, "audio.wav");
  try {
    const captureResult = await captureFn({
      outputPath: wavPath,
      durationSeconds,
      screenRect,
      ...captureOptions,
    });
    const audioPath = captureResult?.outputPath || wavPath;
    const audio = await fs.readFile(audioPath);
    const asrResult = await transcribeFn(audio, {
      ...(modelConfig ?? {}),
      workerPath,
      modelId: modelId || modelConfig?.modelId,
      ...transcribeOptions,
    });
    const transcript = String(asrResult?.text ?? asrResult ?? "").trim();
    if (!transcript) throw createVideoPipelineError("V2T 没有返回转录文本。", "video_transcript_empty");

    const summaryResult = await summaryFn({ title: record.title, transcript });
    const summary = String(summaryResult?.summary ?? summaryResult ?? "").trim();
    const notePath = await noteFn({
      ...noteOptions,
      title: record.title,
      provider: record.provider,
      messageTime: record.message_time,
      capturedAt: record.captured_at,
      sourceUrl: record.source_url,
      asrModel: modelConfig?.modelId || modelId || "",
      summary,
      summaryMethod: summaryResult?.method || "heuristic",
      transcript,
    });

    const resolvedRecord = await replaceVideoRecord(indexPath, record.dedupe_key, {
      record_type: "video",
      video_status: "resolved",
      pending_reason: null,
      processed_at: new Date().toISOString(),
      note_path: notePath,
      transcript_chars: transcript.length,
      summary_excerpt: summary.slice(0, 500),
      summary_method: summaryResult?.method || "heuristic",
      asr_model: modelConfig?.modelId || modelId || null,
      capture_duration_seconds: durationSeconds,
      video_error: null,
      video_error_code: null,
    });
    return { record: resolvedRecord, transcript, summary, notePath };
  } catch (error) {
    const attempts = Number(record.video_attempts || 0) + 1;
    const failedRecord = await replaceVideoRecord(indexPath, record.dedupe_key, {
      record_type: "pending_item",
      video_status: "failed",
      pending_reason: "video_processing_failed",
      video_attempts: attempts,
      video_error_code: error?.code || "video_processing_failed",
      video_error: sanitizeErrorMessage(error?.message || String(error)),
      failed_at: new Date().toISOString(),
    });
    return { record: failedRecord, error };
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
}

export async function resolveVideoAsrConfig({
  modelRoot,
  modelId,
  statusPath,
  v2tRoot,
  workerPath,
} = {}) {
  const modelConfig = await resolveV2tModelConfig({ modelRoot, modelId, statusPath });
  const resolvedWorkerPath = resolveV2tWorkerPath({ v2tRoot, workerPath });
  return { ...modelConfig, workerPath: resolvedWorkerPath };
}

function expandHome(value) {
  const text = String(value ?? "");
  return text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
}

function sanitizeFilename(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

function formatFileTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "undated";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}`;
}

function yamlString(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

function sanitizeErrorMessage(message) {
  return String(message).replace(/[\r\n]+/g, " ").slice(0, 500);
}

function createVideoPipelineError(message, code, cause = undefined) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
