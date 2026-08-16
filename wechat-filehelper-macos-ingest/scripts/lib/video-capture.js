import { spawn as defaultSpawn, execFile as defaultExecFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const defaultExecFileAsync = promisify(defaultExecFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_AUDIO_CAPTURE_SOURCE_PATH = path.join(moduleDir, "system-audio-capture.swift");
export const SYSTEM_AUDIO_CAPTURE_BINARY_PATH = path.join(
  os.homedir(),
  "Library/Caches/wechat-filehelper-macos-ingest/system-audio-capture"
);

export async function ensureSystemAudioCaptureBinary({
  sourcePath = SYSTEM_AUDIO_CAPTURE_SOURCE_PATH,
  binaryPath = SYSTEM_AUDIO_CAPTURE_BINARY_PATH,
  swiftcPath = process.env.SWIFTC_PATH || "swiftc",
  execFileFn = defaultExecFileAsync,
} = {}) {
  const sourceStat = await fs.stat(sourcePath);
  let binaryStat = null;
  try {
    binaryStat = await fs.stat(binaryPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (binaryStat?.isFile() && binaryStat.mtimeMs >= sourceStat.mtimeMs) return binaryPath;

  await fs.mkdir(path.dirname(binaryPath), { recursive: true });
  try {
    await execFileFn(
      swiftcPath,
      [
        "-swift-version",
        "5",
        "-parse-as-library",
        "-O",
        "-framework",
        "ScreenCaptureKit",
        "-framework",
        "AVFoundation",
        "-framework",
        "CoreMedia",
        "-framework",
        "CoreGraphics",
        sourcePath,
        "-o",
        binaryPath,
      ],
      { maxBuffer: 4 * 1024 * 1024 }
    );
  } catch (error) {
    throw createVideoCaptureError(`无法编译系统音频捕获 helper: ${error.message}`, "capture_helper_compile_failed", error);
  }
  return binaryPath;
}

export async function captureSystemAudioToWav({
  outputPath,
  durationSeconds = 120,
  screenRect = null,
  platform = process.platform,
  sourcePath = SYSTEM_AUDIO_CAPTURE_SOURCE_PATH,
  binaryPath = SYSTEM_AUDIO_CAPTURE_BINARY_PATH,
  swiftcPath = process.env.SWIFTC_PATH || "swiftc",
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  execFileFn = defaultExecFileAsync,
  spawnFn = defaultSpawn,
} = {}) {
  if (platform !== "darwin") {
    throw createVideoCaptureError("系统音频捕获仅支持 macOS。", "capture_platform_unsupported");
  }
  if (!outputPath) {
    throw createVideoCaptureError("系统音频捕获缺少 outputPath。", "capture_output_missing");
  }

  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    throw createVideoCaptureError("durationSeconds 必须在 0 到 3600 秒之间。", "capture_duration_invalid");
  }

  const resolvedOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const captureBinary = await ensureSystemAudioCaptureBinary({ sourcePath, binaryPath, swiftcPath, execFileFn });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wechat-filehelper-video-"));
  const temporaryMoviePath = path.join(tempDir, "capture.mp4");
  let succeeded = false;

  try {
    const captureArgs = ["--output", temporaryMoviePath, "--duration", String(duration)];
    const normalizedRect = normalizeScreenRect(screenRect);
    if (normalizedRect) {
      captureArgs.push(
        "--screen-x",
        String(normalizedRect.x),
        "--screen-y",
        String(normalizedRect.y),
        "--screen-width",
        String(normalizedRect.width),
        "--screen-height",
        String(normalizedRect.height)
      );
    }
    await runProcess(captureBinary, captureArgs, { spawnFn });

    await runProcess(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        temporaryMoviePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        resolvedOutputPath,
      ],
      { spawnFn }
    );

    const outputStat = await fs.stat(resolvedOutputPath);
    if (outputStat.size <= 44) {
      throw createVideoCaptureError("捕获结果没有可用音频。", "capture_audio_empty");
    }
    succeeded = true;
    return { outputPath: resolvedOutputPath, durationSeconds: duration };
  } catch (error) {
    if (error?.code?.startsWith?.("capture_")) throw error;
    throw createVideoCaptureError(`系统音频捕获失败: ${error.message}`, "capture_failed", error);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    if (!succeeded) await fs.rm(resolvedOutputPath, { force: true });
  }
}

function normalizeScreenRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const values = [rect.x, rect.y, rect.width, rect.height].map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) return null;
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function runProcess(command, args, { spawnFn }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().slice(-1000);
      const errorCode = /permission|not authorized|denied|screen recording/i.test(detail)
        ? "capture_permission_denied"
        : "capture_process_failed";
      reject(
        createVideoCaptureError(
          `${command} 退出异常: code=${code ?? "none"}, signal=${signal ?? "none"}${detail ? `, ${detail}` : ""}`,
          errorCode
        )
      );
    });
  });
}

function createVideoCaptureError(message, code, cause = undefined) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
