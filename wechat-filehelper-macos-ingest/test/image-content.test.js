import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ImageContentError,
  createImageContentRecord,
  publishImageContentRecord,
  renderImageContentNote,
} from "../scripts/lib/image-content.js";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildRecord(overrides = {}) {
  return createImageContentRecord({
    capturedAt: "2026-08-29T08:00:00.000Z",
    messageTime: "2026-08-29T07:58:00.000Z",
    chatName: "文件传输助手",
    captureSessionId: "image-session-1",
    ocrResult: {
      width: 1200,
      height: 800,
      lines: [
        { text: "Agent 工作流检查表", confidence: 0.96, x: 20, y: 30, width: 400, height: 50 },
        { text: "先验证假设，再做完整实现", confidence: 0.90, x: 20, y: 100, width: 620, height: 40 },
      ],
    },
    ...overrides,
  });
}

describe("createImageContentRecord", () => {
  it("creates a deterministic image OCR record with a confidence decision", () => {
    const first = buildRecord();
    const second = buildRecord();

    assert.equal(first.record_type, "content");
    assert.equal(first.content_type, "image_ocr");
    assert.equal(first.message_type, "image");
    assert.equal(first.content_text, "Agent 工作流检查表\n先验证假设，再做完整实现");
    assert.equal(first.ocr_confidence, 0.93);
    assert.equal(first.ocr_line_count, 2);
    assert.equal(first.pkm_status, "pending");
    assert.equal(first.content_hash, second.content_hash);
    assert.equal(first.dedupe_key, second.dedupe_key);
    assert.match(first.content_hash, /^[a-f0-9]{64}$/);
  });

  it("keeps low-confidence OCR as needs_review", () => {
    const record = buildRecord({
      ocrResult: {
        width: 1200,
        height: 800,
        lines: [{ text: "可能识别错误的文字", confidence: 0.41 }],
      },
    });

    assert.equal(record.pkm_status, "needs_review");
    assert.equal(record.ocr_confidence, 0.41);
  });

  it("distinguishes empty OCR from a valid empty result", () => {
    assert.throws(
      () => buildRecord({ ocrResult: { width: 1200, height: 800, lines: [] } }),
      (error) => error instanceof ImageContentError && error.code === "image_ocr_empty",
    );
  });

  it("preserves fallback timestamp provenance in the image record and note", () => {
    const record = buildRecord({ messageTimeSource: "range_until_fallback" });

    assert.equal(record.message_time_source, "range_until_fallback");
    assert.match(
      renderImageContentNote(record),
      /message_time_source: "range_until_fallback"/,
    );
  });
});

describe("renderImageContentNote", () => {
  it("renders deterministic Markdown with the complete OCR text", () => {
    const note = renderImageContentNote(buildRecord());

    assert.match(note, /content_type: image_ocr/);
    assert.match(note, /pkm_status: pending/);
    assert.match(note, /## 图片文字/);
    assert.match(note, /Agent 工作流检查表\n先验证假设，再做完整实现/);
  });

  it("makes low-confidence content visibly reviewable", () => {
    const note = renderImageContentNote(buildRecord({
      ocrResult: { lines: [{ text: "模糊文字", confidence: 0.4 }] },
    }));

    assert.match(note, /pkm_status: needs_review/);
    assert.match(note, /OCR 置信度较低，请对照原图复核/);
  });
});

describe("publishImageContentRecord", () => {
  it("atomically writes and verifies a high-confidence note", async () => {
    const root = await makeTempDir("wechat-image-note-");
    const noteDir = path.join(root, "vault", "Clippings");
    const result = await publishImageContentRecord(buildRecord(), {
      resolveObsidianDirFn: async () => noteDir,
    });

    assert.equal(result.pkm_status, "written");
    assert.equal(path.dirname(result.note_path), noteDir);
    assert.match(path.basename(result.note_path), /^2026-08-29-agent-/);
    const written = await fs.readFile(result.note_path, "utf8");
    assert.equal(written, renderImageContentNote(result));
    assert.match(written, /pkm_status: written/);
    assert.deepEqual(
      (await fs.readdir(noteDir)).filter((name) => name.includes(".part-")),
      [],
    );
  });

  it("writes low-confidence OCR but preserves needs_review", async () => {
    const root = await makeTempDir("wechat-image-review-");
    const record = buildRecord({
      ocrResult: { lines: [{ text: "模糊文字", confidence: 0.4 }] },
    });
    const result = await publishImageContentRecord(record, {
      resolveObsidianDirFn: async () => path.join(root, "Clippings"),
    });

    assert.equal(result.pkm_status, "needs_review");
    assert.match(await fs.readFile(result.note_path, "utf8"), /请对照原图复核/);
  });
});
