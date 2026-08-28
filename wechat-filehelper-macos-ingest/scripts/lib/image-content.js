import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { dedupeKey } from "./common.js";
import { resolveObsidianClippingsDir } from "./video-channel-runtime.js";

const DEFAULT_REVIEW_THRESHOLD = 0.75;

export class ImageContentError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "ImageContentError";
    this.code = code;
  }
}

export function createImageContentRecord({
  capturedAt = new Date().toISOString(),
  messageTime,
  chatName,
  title = "",
  captureSessionId,
  source = "ui",
  ocrResult,
  reviewThreshold = DEFAULT_REVIEW_THRESHOLD,
}) {
  const lines = (Array.isArray(ocrResult?.lines) ? ocrResult.lines : [])
    .map((line) => ({
      text: String(line?.text ?? "").trim(),
      confidence: normalizeConfidence(line?.confidence),
    }))
    .filter((line) => line.text);
  if (lines.length === 0) {
    throw new ImageContentError("image_ocr_empty", "Image OCR returned no usable text");
  }

  const contentText = lines.map((line) => line.text).join("\n");
  const contentHash = crypto.createHash("sha256").update(contentText.normalize("NFKC"), "utf8").digest("hex");
  const confidence = roundConfidence(
    lines.reduce((total, line) => total + line.confidence, 0) / lines.length,
  );
  const messageTimeIso = new Date(messageTime ?? capturedAt).toISOString();
  const resolvedTitle = String(title).trim() || lines[0].text.slice(0, 80);

  return {
    captured_at: new Date(capturedAt).toISOString(),
    message_time: messageTimeIso,
    chat_name: String(chatName ?? "文件传输助手"),
    record_type: "content",
    content_type: "image_ocr",
    message_type: "image",
    title: resolvedTitle,
    content_text: contentText,
    content_hash: contentHash,
    ocr_confidence: confidence,
    ocr_line_count: lines.length,
    ocr_lines: lines,
    pkm_status: confidence >= reviewThreshold ? "pending" : "needs_review",
    dedupe_key: dedupeKey(
      String(chatName ?? "文件传输助手"),
      messageTimeIso,
      `image:${contentHash}`,
    ),
    capture_session_id: String(captureSessionId ?? ""),
    source,
  };
}

export function renderImageContentNote(record) {
  const reviewWarning =
    record.pkm_status === "needs_review"
      ? "> [!warning] OCR 置信度较低，请对照原图复核。\n\n"
      : "";

  return [
    "---",
    `title: ${yamlString(record.title)}`,
    `source: ${yamlString(record.chat_name)}`,
    "content_type: image_ocr",
    `captured_at: ${yamlString(record.captured_at)}`,
    `message_time: ${yamlString(record.message_time)}`,
    `ocr_confidence: ${record.ocr_confidence}`,
    `ocr_line_count: ${record.ocr_line_count}`,
    `pkm_status: ${record.pkm_status}`,
    `dedupe_key: ${yamlString(record.dedupe_key)}`,
    "---",
    "",
    `# ${record.title}`,
    "",
    reviewWarning + "## 图片文字",
    "",
    record.content_text,
    "",
  ].join("\n");
}

export async function publishImageContentRecord(
  record,
  {
    resolveObsidianDirFn = () => resolveObsidianClippingsDir(),
    fsImpl = fs,
  } = {},
) {
  let noteDir;
  try {
    noteDir = await resolveObsidianDirFn();
  } catch (error) {
    throw new ImageContentError(
      "image_note_target_unavailable",
      "The Obsidian Clippings directory could not be resolved",
      error,
    );
  }
  if (!String(noteDir ?? "").trim()) {
    throw new ImageContentError(
      "image_note_target_unavailable",
      "The Obsidian Clippings directory is empty",
    );
  }

  const finalStatus = record.pkm_status === "needs_review" ? "needs_review" : "written";
  const date = String(record.message_time ?? record.captured_at).slice(0, 10);
  const filename = `${date}-${slugify(record.title)}-${record.content_hash.slice(0, 8)}.md`;
  const notePath = path.join(noteDir, filename);
  const publishedRecord = {
    ...record,
    pkm_status: finalStatus,
    note_path: notePath,
  };
  const note = renderImageContentNote(publishedRecord);
  const partPath = `${notePath}.part-${process.pid}-${Date.now()}`;

  try {
    await fsImpl.mkdir(noteDir, { recursive: true });
    const existing = await readIfExists(notePath, fsImpl);
    if (existing != null) {
      if (existing !== note) {
        throw new ImageContentError(
          "image_note_conflict",
          `A different note already exists at ${notePath}`,
        );
      }
      return publishedRecord;
    }

    await fsImpl.writeFile(partPath, note, { encoding: "utf8", flag: "wx" });
    await fsImpl.rename(partPath, notePath);
    const written = await fsImpl.readFile(notePath, "utf8");
    if (written !== note) {
      throw new ImageContentError(
        "image_note_verification_failed",
        `The written image note could not be verified at ${notePath}`,
      );
    }
    return publishedRecord;
  } catch (error) {
    if (error instanceof ImageContentError) throw error;
    throw new ImageContentError(
      "image_note_write_failed",
      `Image OCR note could not be written at ${notePath}`,
      error,
    );
  } finally {
    await fsImpl.rm(partPath, { force: true }).catch(() => {});
  }
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function roundConfidence(value) {
  return Math.round(value * 10_000) / 10_000;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "image";
}

async function readIfExists(filePath, fsImpl) {
  try {
    return await fsImpl.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
