import { fork as defaultFork } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalizeUrl, dedupeKey } from "./common.js";

export const VIDEO_CONTENT_TYPE = "video";
export const VIDEO_PROVIDER_WECHAT_CHANNELS = "wechat_channels";
export const VIDEO_PENDING_REASON = "video_content_not_processed";
export const V2T_DEFAULT_MODEL_ID = "qwen3-asr-0.6b";
export const V2T_DEFAULT_SHERPA_MODEL_TYPE = "qwen3Asr";

export function resolveV2tWorkerPath({
  v2tRoot = process.env.V2T_ROOT || path.join(os.homedir(), "Documents/AI/Codex/V2T"),
  workerPath = "",
} = {}) {
  const resolvedPath = workerPath || path.join(v2tRoot, "dist", "main", "asrTranscriptionWorker.js");
  if (!existsSync(resolvedPath)) {
    throw createVideoAsrError(`V2T ASR worker is not installed: ${resolvedPath}`, "v2t_worker_missing");
  }
  return resolvedPath;
}

export function createPendingVideoRecord({
  capturedAt = new Date(),
  messageTime = null,
  chatName = "文件传输助手",
  title = "",
  rawText = "",
  shareUrl = "",
  videoFingerprint = "",
  captureSessionId = "",
  source = "ui",
  pendingWindowSince = null,
  pendingWindowUntil = null,
} = {}) {
  const capturedAtIso = toIsoString(capturedAt) ?? new Date().toISOString();
  const messageTimeIso = toIsoString(messageTime);
  const canonicalShareUrl = shareUrl ? canonicalizeUrl(shareUrl) : "";
  const basis =
    videoFingerprint ||
    canonicalShareUrl ||
    normalizeVideoText(`${title}\n${rawText}`) ||
    VIDEO_PENDING_REASON;
  const keyTime = messageTimeIso || `${pendingWindowSince ?? ""}|${pendingWindowUntil ?? ""}`;
  const dedupe = dedupeKey(chatName, keyTime, `video:${basis}`);

  return {
    captured_at: capturedAtIso,
    message_time: messageTimeIso,
    chat_name: chatName,
    record_type: "pending_item",
    content_type: VIDEO_CONTENT_TYPE,
    provider: VIDEO_PROVIDER_WECHAT_CHANNELS,
    video_status: "pending",
    title: title || "(untitled video)",
    raw_text: rawText || "",
    source_url: canonicalShareUrl || null,
    pending_reason: VIDEO_PENDING_REASON,
    dedupe_key: dedupe,
    capture_session_id: captureSessionId,
    source,
    pending_window_since: pendingWindowSince,
    pending_window_until: pendingWindowUntil,
  };
}

export async function resolveV2tModelConfig({
  modelRoot = path.join(os.homedir(), "Library/Application Support/V2T/models"),
  modelId = V2T_DEFAULT_MODEL_ID,
  statusPath = path.join(modelRoot, "model-status.json"),
} = {}) {
  let status;
  try {
    status = JSON.parse(await fs.readFile(statusPath, "utf8"));
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "model_status_missing" : "model_status_unreadable";
    throw createVideoAsrError(`V2T model status is unavailable: ${reason}`, reason, error);
  }

  const modelStatus = status?.[modelId];
  const modelPath = modelStatus?.modelPath;
  if (!modelPath || !existsSync(modelPath)) {
    throw createVideoAsrError(`V2T model is not installed: ${modelId}`, "v2t_model_missing");
  }

  return {
    modelId,
    modelPath,
    sherpaModelType: inferSherpaModelType(modelId),
  };
}

export function transcribeWavWithV2t(
  audio,
  {
    workerPath,
    modelId = V2T_DEFAULT_MODEL_ID,
    modelPath,
    sherpaModelType = V2T_DEFAULT_SHERPA_MODEL_TYPE,
    language = "zh",
    runtime = {
      provider: "cpu",
      providerLabel: "CPU",
      numThreads: 2,
      gpuEnabled: false,
      backendStatus: "cpu",
    },
    timeoutMs = 180_000,
    forkProcess = defaultFork,
  } = {}
) {
  if (!workerPath) {
    return Promise.reject(createVideoAsrError("V2T worker path is not configured.", "v2t_worker_missing"));
  }
  if (!modelPath) {
    return Promise.reject(createVideoAsrError("V2T model path is not configured.", "v2t_model_missing"));
  }

  let child;
  try {
    child = forkProcess(workerPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "advanced",
    });
  } catch (error) {
    return Promise.reject(
      createVideoAsrError(`V2T ASR worker failed to start: ${error.message}`, "v2t_worker_start_failed", error)
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    let heartbeatAt = null;
    let chunkProgress = null;
    const timeout = setTimeout(() => {
      child.kill?.();
      finishError(
        createVideoAsrError(`V2T ASR worker timed out after ${Math.round(timeoutMs / 1000)} seconds.`, "v2t_worker_timeout", {
          heartbeatAt,
          chunkProgress,
          stderr: stderr.trim() || null,
        })
      );
    }, timeoutMs);

    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      return true;
    };
    const finishError = (error) => {
      if (finish()) reject(error);
    };

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("message", (message) => {
      if (message?.type === "heartbeat") {
        heartbeatAt = message.at ?? heartbeatAt;
        return;
      }
      if (message?.type === "chunk-progress") {
        chunkProgress = { current: message.current, total: message.total };
        return;
      }
      if (message?.type === "result" && message.ok) {
        if (finish()) resolve({ text: String(message.text ?? "") });
        return;
      }
      if (message?.type === "result" && !message.ok) {
        finishError(
          createVideoAsrError(message.error || "V2T ASR worker failed.", "v2t_worker_error", {
            heartbeatAt,
            chunkProgress,
            stderr: stderr.trim() || null,
            diagnostic: message.diagnostic ?? null,
          })
        );
      }
    });
    child.on("error", (error) => {
      finishError(createVideoAsrError(`V2T ASR worker failed to start: ${error.message}`, "v2t_worker_start_failed", error));
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        finishError(
          createVideoAsrError(
            `V2T ASR worker exited unexpectedly: ${stderr.trim() || `exit=${code ?? "none"} signal=${signal ?? "none"}`}`,
            "v2t_worker_crashed",
            { code, signal, stderr: stderr.trim() || null, heartbeatAt, chunkProgress }
          )
        );
      }
    });

    child.send?.({
      audio: audio instanceof Uint8Array ? audio : new Uint8Array(audio),
      modelId,
      modelPath,
      sherpaModelType,
      language,
      runtime,
    });
  });
}

function inferSherpaModelType(modelId) {
  const value = String(modelId).toLowerCase();
  if (value.includes("funasr-nano") || value.includes("fun-asr-nano")) return "funasrNano";
  if (value.includes("qwen3-asr")) return "qwen3Asr";
  if (value.includes("sensevoice")) return "senseVoice";
  return "senseVoice";
}

function normalizeVideoText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[【】\[\]（）()、，。,:：;；.!！?？"'`~\-_/\\|]/g, "")
    .slice(0, 240);
}

function toIsoString(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function createVideoAsrError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details instanceof Error) error.cause = details;
  else if (details !== undefined) error.diagnostic = details;
  return error;
}
