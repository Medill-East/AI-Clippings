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
import {
  buildHeuristicSummary,
  listPendingVideoRecords,
  processVideoRecord,
  resolveObsidianVaultPath,
  summarizeTranscript,
} from "../scripts/lib/video-pipeline.js";
import { captureSystemAudioToWav } from "../scripts/lib/video-capture.js";
import { processPendingVideos } from "../scripts/process-videos.js";

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

  it("resolves the active macOS Obsidian vault and writes a usable video note", async () => {
    const root = await makeTempDir("wechat-filehelper-video-vault-");
    const vaultPath = path.join(root, "MyVault");
    await fs.mkdir(vaultPath);
    const configPath = path.join(root, "obsidian.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        vaults: {
          active: { path: vaultPath, open: true, ts: 2 },
        },
      })
    );

    assert.equal(await resolveObsidianVaultPath({ configPath }), vaultPath);

    const indexPath = path.join(root, "links.jsonl");
    const record = createPendingVideoRecord({
      capturedAt: "2026-08-16T01:00:00.000Z",
      messageTime: "2026-08-16T00:59:00.000Z",
      title: "视频号测试标题",
      rawText: "视频号测试标题",
      videoFingerprint: "video-note-test",
    });
    await fs.writeFile(indexPath, `${JSON.stringify(record)}\n`);

    const result = await processVideoRecord(record, {
      indexPath,
      durationSeconds: 3,
      modelConfig: { modelId: "qwen3-asr-0.6b", modelPath: "/tmp/model" },
      workerPath: "/tmp/worker.js",
      captureFn: async ({ outputPath }) => {
        await fs.writeFile(outputPath, Buffer.from([1, 2, 3]));
        return { outputPath };
      },
      transcribeFn: async (audio) => {
        assert.deepEqual([...audio], [1, 2, 3]);
        return { text: "这是视频中的第一句话。这里是第二个要点。" };
      },
      noteOptions: { vaultPath },
    });

    assert.equal(result.record.record_type, "video");
    assert.equal(result.record.video_status, "resolved");
    assert.equal(result.record.transcript_chars, 20);
    assert.match(result.notePath, /Video Clips/);
    const note = await fs.readFile(result.notePath, "utf8");
    assert.match(note, /这是视频中的第一句话/);
    assert.match(note, /summary_method: "heuristic"/);
    assert.equal((await listPendingVideoRecords(indexPath)).length, 0);
  });

  it("marks a failed video as retryable instead of losing the pending record", async () => {
    const root = await makeTempDir("wechat-filehelper-video-failure-");
    const indexPath = path.join(root, "links.jsonl");
    const record = createPendingVideoRecord({ title: "待重试视频", videoFingerprint: "video-failure-test" });
    await fs.writeFile(indexPath, `${JSON.stringify(record)}\n`);

    const result = await processVideoRecord(record, {
      indexPath,
      captureFn: async () => {
        const error = new Error("没有系统音频权限");
        error.code = "capture_permission_denied";
        throw error;
      },
    });

    assert.equal(result.record.record_type, "pending_item");
    assert.equal(result.record.video_status, "failed");
    assert.equal(result.record.video_error_code, "capture_permission_denied");
    assert.equal((await listPendingVideoRecords(indexPath)).length, 1);
  });

  it("uses a local OpenAI-compatible summary when available and falls back without it", async () => {
    assert.match(buildHeuristicSummary("第一句。第二句。"), /第一句/);
    const result = await summarizeTranscript({
      title: "测试",
      transcript: "视频转录",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      fetchFn: async (url, options) => {
        assert.equal(url, "http://127.0.0.1:11434/v1/chat/completions");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "local-model");
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "本地模型摘要" } }] };
          },
        };
      },
    });
    assert.equal(result.method, "local_llm");
    assert.equal(result.summary, "本地模型摘要");
  });

  it("discovers the first local model when no summary model is configured", async () => {
    const requested = [];
    const result = await summarizeTranscript({
      transcript: "测试转录",
      baseUrl: "http://127.0.0.1:11434/v1",
      fetchFn: async (url, options) => {
        requested.push(url);
        if (url.endsWith("/models")) {
          return { ok: true, async json() { return { data: [{ id: "local-first-model" }] }; } };
        }
        const body = JSON.parse(options.body);
        assert.equal(body.model, "local-first-model");
        return { ok: true, async json() { return { choices: [{ message: { content: "自动模型摘要" } }] }; } };
      },
    });
    assert.deepEqual(requested, [
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:11434/v1/chat/completions",
    ]);
    assert.equal(result.summary, "自动模型摘要");
  });

  it("converts the transient capture container to WAV and removes the container", async () => {
    const root = await makeTempDir("wechat-filehelper-video-capture-");
    const sourcePath = path.join(root, "capture.swift");
    const binaryPath = path.join(root, "capture-helper");
    const outputPath = path.join(root, "audio.wav");
    await fs.writeFile(sourcePath, "source");

    const commands = [];
    const fakeExecFile = async (_command, args) => {
      commands.push(args);
      await fs.writeFile(args.at(-1), "binary");
    };
    const fakeSpawn = (command, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(async () => {
        if (command === binaryPath) {
          const moviePath = args[args.indexOf("--output") + 1];
          await fs.writeFile(moviePath, "temporary movie");
        } else {
          await fs.writeFile(args.at(-1), Buffer.alloc(100));
        }
        child.emit("close", 0, null);
      });
      return child;
    };

    await captureSystemAudioToWav({
      outputPath,
      durationSeconds: 2,
      screenRect: { x: 10, y: 20, width: 300, height: 200 },
      platform: "darwin",
      sourcePath,
      binaryPath,
      ffmpegPath: "ffmpeg-test",
      execFileFn: fakeExecFile,
      spawnFn: fakeSpawn,
    });

    assert.equal(commands.length, 1);
    assert.equal((await fs.stat(outputPath)).size, 100);
    assert.equal((await fs.readdir(root)).includes("capture-helper"), true);
  });

  it("orchestrates pending video processing for the shared collect command", async () => {
    const root = await makeTempDir("wechat-filehelper-video-orchestrator-");
    const record = createPendingVideoRecord({ title: "collect 内置视频", videoFingerprint: "collect-video" });
    const logs = [];
    const result = await processPendingVideos({
      indexPath: path.join(root, "links.jsonl"),
      records: [record],
      durationSeconds: 7,
      limit: Number.POSITIVE_INFINITY,
      noPrompt: true,
      outputDir: path.join(root, "notes"),
      resolveAsrFn: async () => ({ modelId: "test-asr", workerPath: "/tmp/test-worker.js" }),
      getWindowFn: () => ({ x: 1, y: 2, width: 300, height: 200 }),
      processRecordFn: async (input, options) => {
        assert.equal(input.dedupe_key, record.dedupe_key);
        assert.equal(options.durationSeconds, 7);
        assert.deepEqual(options.screenRect, { x: 1, y: 2, width: 300, height: 200 });
        return { record: { ...input, record_type: "video", video_status: "resolved" }, notePath: "/tmp/test-note.md" };
      },
      log: { log: (message) => logs.push(message), error: (message) => logs.push(message) },
    });

    assert.equal(result.pendingCount, 1);
    assert.equal(result.selectedCount, 1);
    assert.equal(result.resolvedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.ok(logs.some((message) => String(message).includes("待处理视频 1 条")));
  });
});
