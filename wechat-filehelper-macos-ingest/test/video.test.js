import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPendingVideoRecord,
  resolveV2tModelConfig,
  resolveV2tWorkerPath,
  transcribeWavWithV2t,
} from "../scripts/lib/video.js";

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

describe("video helpers", () => {
  it("creates a deduplicable pending video record without requiring a URL", () => {
    const first = createPendingVideoRecord({
      capturedAt: new Date("2026-08-16T01:00:00.000Z"),
      messageTime: new Date("2026-08-16T00:59:00.000Z"),
      title: "一个视频号标题",
      rawText: "一个视频号标题\n作者",
      videoFingerprint: "video-title-fingerprint",
      captureSessionId: "session-1",
      pendingWindowSince: "2026-08-16T00:00:00.000Z",
      pendingWindowUntil: "2026-08-16T02:00:00.000Z",
    });
    const second = createPendingVideoRecord({
      capturedAt: new Date("2026-08-16T01:02:00.000Z"),
      messageTime: new Date("2026-08-16T00:59:00.000Z"),
      title: "视频号标题 OCR 漂移",
      rawText: "视频号标题 OCR 漂移",
      videoFingerprint: "video-title-fingerprint",
      captureSessionId: "session-2",
      pendingWindowSince: "2026-08-16T00:00:00.000Z",
      pendingWindowUntil: "2026-08-16T02:00:00.000Z",
    });

    assert.equal(first.record_type, "pending_item");
    assert.equal(first.content_type, "video");
    assert.equal(first.provider, "wechat_channels");
    assert.equal(first.video_status, "pending");
    assert.equal(first.source_url, null);
    assert.equal(first.dedupe_key, second.dedupe_key);
  });

  it("resolves an installed V2T model from model-status.json", async () => {
    const root = await makeTempDir("wechat-filehelper-v2t-model-");
    const modelPath = path.join(root, "encoder.int8.onnx");
    await fs.writeFile(modelPath, "model-placeholder");
    await fs.writeFile(
      path.join(root, "model-status.json"),
      JSON.stringify({
        "qwen3-asr-0.6b": {
          status: "current",
          modelPath,
        },
      })
    );

    const config = await resolveV2tModelConfig({ modelRoot: root });
    assert.deepEqual(config, {
      modelId: "qwen3-asr-0.6b",
      modelPath,
      sherpaModelType: "qwen3Asr",
    });
  });

  it("resolves the V2T worker from the local project root", async () => {
    const root = await makeTempDir("wechat-filehelper-v2t-worker-");
    const workerPath = path.join(root, "dist", "main", "asrTranscriptionWorker.js");
    await fs.mkdir(path.dirname(workerPath), { recursive: true });
    await fs.writeFile(workerPath, "// worker placeholder");

    assert.equal(resolveV2tWorkerPath({ v2tRoot: root }), workerPath);
  });

  it("passes temporary WAV bytes to the V2T worker and returns its transcript", async () => {
    let sentMessage = null;
    const fakeFork = () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => {};
      child.send = (message) => {
        sentMessage = message;
        queueMicrotask(() => child.emit("message", { type: "result", ok: true, text: "视频转录结果" }));
      };
      return child;
    };

    const result = await transcribeWavWithV2t(Buffer.from([1, 2, 3]), {
      workerPath: "/tmp/v2t/asrTranscriptionWorker.js",
      modelPath: "/tmp/v2t/model.onnx",
      runtime: { provider: "cpu", numThreads: 1 },
      forkProcess: fakeFork,
    });

    assert.equal(result.text, "视频转录结果");
    assert.deepEqual([...sentMessage.audio], [1, 2, 3]);
    assert.equal(sentMessage.modelId, "qwen3-asr-0.6b");
    assert.equal(sentMessage.sherpaModelType, "qwen3Asr");
    assert.deepEqual(sentMessage.runtime, { provider: "cpu", numThreads: 1 });
  });
});
