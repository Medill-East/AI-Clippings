import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PipelineError } from "../scripts/lib/video-channel-pipeline.js";
import * as videoChannelRuntime from "../scripts/lib/video-channel-runtime.js";

const {
  downloadVideoMedia,
  loadResolvedVault,
  resolveObsidianClippingsDir,
  summarizeWithCodex,
  transcribeWithV2T,
} = videoChannelRuntime;

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

describe("downloadVideoMedia", () => {
  it("streams to a part file, probes duration, and atomically promotes the MP4", async () => {
    const root = await makeTempDir("video-download-");
    const mediaPath = path.join(root, "media.mp4");
    const calls = [];

    const result = await downloadVideoMedia(
      { videoUrl: "https://media.example.test/video.mp4" },
      mediaPath,
      {
        minimumBytes: 3,
        fetchImpl: async (_url, options) => {
          calls.push(options);
          return new Response(new Uint8Array([0, 1, 2, 3]), {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": "4" },
          });
        },
        execFileFn: async (_command, args) => {
          assert.equal(args.at(-1), `${mediaPath}.part`);
          return {
            stdout: JSON.stringify({
              format: { duration: "42.25", size: "4" },
              streams: [{ codec_type: "video" }, { codec_type: "audio" }],
            }),
          };
        },
      },
    );

    assert.equal(result.bytes, 4);
    assert.equal(result.durationSeconds, 42.25);
    assert.deepEqual(await fs.readFile(mediaPath), Buffer.from([0, 1, 2, 3]));
    assert.equal(calls[0].headers.referer, "https://channels.weixin.qq.com/");
  });

  it("rejects an image response with media_invalid", async () => {
    const root = await makeTempDir("video-download-invalid-");
    await assert.rejects(
      downloadVideoMedia(
        { videoUrl: "https://media.example.test/not-video" },
        path.join(root, "media.mp4"),
        {
          fetchImpl: async () =>
            new Response(new Uint8Array([0]), {
              status: 200,
              headers: { "content-type": "image/jpeg" },
            }),
        },
      ),
      (error) => error instanceof PipelineError && error.code === "media_invalid",
    );
  });
});

describe("transcribeWithV2T", () => {
  it("finds V2T in the Director workspace when the checkout sibling is absent", async () => {
    const homeDir = await makeTempDir("video-v2t-layout-");
    const clippingsRootPath = path.join(
      homeDir,
      "Documents",
      "GitHub",
      "AI-Clippings",
    );
    const expectedPath = path.join(
      homeDir,
      "Documents",
      "AI",
      "Codex",
      "V2T",
      "dist",
      "core",
      "asrProviders.js",
    );
    await fs.mkdir(path.dirname(expectedPath), { recursive: true });
    await fs.writeFile(expectedPath, "export const runtime = true;\n");

    assert.equal(
      typeof videoChannelRuntime.resolveV2TRuntimeModulePath,
      "function",
    );
    assert.equal(
      await videoChannelRuntime.resolveV2TRuntimeModulePath({
        clippingsRootPath,
        homeDir,
      }),
      expectedPath,
    );
  });

  it("extracts ordered frame text and removes recurring visual watermarks", async () => {
    const root = await makeTempDir("video-visual-ocr-");
    const mediaPath = path.join(root, "media.mp4");
    const framesDir = path.join(root, "frames");
    await fs.writeFile(mediaPath, "media");

    assert.equal(
      typeof videoChannelRuntime.extractVisualTextFromVideo,
      "function",
    );
    const result = await videoChannelRuntime.extractVisualTextFromVideo(mediaPath, {
      durationSeconds: 14,
      framesDir,
      ignoredTexts: ["同炁TONGQI"],
      execFileFn: async (_command, args) => {
        const outputPattern = args.at(-1);
        await fs.mkdir(path.dirname(outputPattern), { recursive: true });
        for (let index = 1; index <= 3; index += 1) {
          await fs.writeFile(
            outputPattern.replace("%03d", String(index).padStart(3, "0")),
            `frame-${index}`,
          );
        }
      },
      recognizeTextFromImageFn: async (framePath) => {
        const frame = path.basename(framePath);
        const unique = frame === "frame-001.jpg" ? "毛发收集" :
          frame === "frame-002.jpg" ? "碳化提纯" : "";
        const watermark = frame === "frame-002.jpg" ? "同悉TONGOI" : "同炁TONGQI";
        return {
          lines: [
            ...(unique ? [{ text: unique, confidence: 0.95 }] : []),
            ...(frame === "frame-001.jpg"
              ? [{ text: "79", confidence: 0.9 }]
              : []),
            { text: watermark, confidence: 0.9 },
          ],
        };
      },
    });

    assert.equal(result.frameCount, 3);
    assert.match(result.text, /毛发收集/);
    assert.match(result.text, /碳化提纯/);
    assert.doesNotMatch(result.text, /TONG[QO]I/);
    assert.doesNotMatch(result.text, /79/);
  });

  it("reuses the configured local V2T model and writes a temporary transcript", async () => {
    const root = await makeTempDir("video-v2t-");
    const mediaPath = path.join(root, "media.mp4");
    const transcriptPath = path.join(root, "transcript.txt");
    const settingsPath = path.join(root, "settings.json");
    const modelPath = path.join(root, "model", "model.int8.onnx");
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(mediaPath, "media");
    await fs.writeFile(modelPath, "model");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        providers: {
          asr: {
            modelId: "sensevoice-test",
            modelPath,
            sherpaModelType: "senseVoice",
            language: "zh",
          },
        },
      }),
    );

    let providerOptions;
    const onProgress = () => {};
    const result = await transcribeWithV2T(mediaPath, transcriptPath, {
      settingsPath,
      onProgress,
      execFileFn: async (_command, args) => {
        const wavPath = args.at(-1);
        await fs.writeFile(wavPath, "wav-bytes");
        return { stdout: "", stderr: "" };
      },
      importV2TFn: async () => ({
        LocalSherpaAsrProvider: class {
          constructor(options) {
            providerOptions = options;
          }

          async transcribe(audio) {
            assert.equal(audio.toString(), "wav-bytes");
            return { text: "这是 V2T 本地模型输出的有效逐字稿。" };
          }
        },
      }),
    });

    assert.equal(result.text, "这是 V2T 本地模型输出的有效逐字稿。");
    assert.equal(result.provider, "v2t-local:sensevoice-test");
    assert.equal(providerOptions.modelPath, modelPath);
    assert.equal(providerOptions.sherpaModelType, "senseVoice");
    assert.equal(providerOptions.onChunkProgress, onProgress);
    assert.equal(await fs.readFile(transcriptPath, "utf8"), result.text);
  });

  it("falls back to frame OCR when local ASR contains no usable video content", async () => {
    const root = await makeTempDir("video-v2t-visual-fallback-");
    const mediaPath = path.join(root, "media.mp4");
    const transcriptPath = path.join(root, "transcript.txt");
    const settingsPath = path.join(root, "settings.json");
    const modelPath = path.join(root, "model", "model.int8.onnx");
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(mediaPath, "media");
    await fs.writeFile(modelPath, "model");
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        providers: {
          asr: {
            modelId: "sensevoice-test",
            modelPath,
            sherpaModelType: "senseVoice",
          },
        },
      }),
    );

    let visualCalls = 0;
    const result = await transcribeWithV2T(mediaPath, transcriptPath, {
      settingsPath,
      profile: { durationSeconds: 14 },
      execFileFn: async (_command, args) => {
        await fs.writeFile(args.at(-1), "wav-bytes");
      },
      importV2TFn: async () => ({
        LocalSherpaAsrProvider: class {
          async transcribe() {
            return { text: "系统。" };
          }
        },
      }),
      extractVisualTextFn: async () => {
        visualCalls += 1;
        return {
          text: "[00:00] 毛发收集\n[00:04] 取出钻石原坯\n[00:10] 人工精磨",
          frameCount: 7,
        };
      },
    });

    assert.equal(visualCalls, 1);
    assert.equal(result.evidenceType, "visual_ocr");
    assert.equal(result.visualOcrFrames, 7);
    assert.match(result.text, /\[画面 OCR\]/);
    assert.match(result.text, /毛发收集/);
    assert.doesNotMatch(result.text, /系统。/);
    assert.equal(await fs.readFile(transcriptPath, "utf8"), result.text);
  });
});

describe("summarizeWithCodex", () => {
  it("accepts only the structured summary contract", async () => {
    const root = await makeTempDir("video-summary-");
    const result = await summarizeWithCodex(
      {
        transcript: "这是一段包含多个事实和结论的逐字稿。",
        profile: { title: "标题", author: "作者" },
        taskDir: root,
      },
      {
        invokeCodexFn: async ({ outputPath, prompt }) => {
          assert.match(prompt, /untrusted_transcript/);
          assert.match(prompt, /视频内容证据/);
          assert.match(prompt, /画面 OCR/);
          await fs.writeFile(
            outputPath,
            JSON.stringify({
              summary: "这是忠于原内容并去除口语冗余的摘要。",
              key_points: ["要点一", "要点二", "要点三"],
            }),
          );
        },
      },
    );

    assert.equal(result.key_points.length, 3);
    assert.match(result.summary, /摘要/);
  });

  it("reports malformed model output instead of returning an empty summary", async () => {
    const root = await makeTempDir("video-summary-invalid-");
    await assert.rejects(
      summarizeWithCodex(
        { transcript: "逐字稿", profile: {}, taskDir: root },
        {
          invokeCodexFn: async ({ outputPath }) => {
            await fs.writeFile(outputPath, "not json");
          },
        },
      ),
      (error) =>
        error instanceof PipelineError && error.code === "summary_invalid_json",
    );
  });
});

describe("resolveObsidianClippingsDir", () => {
  it("reuses the directory proven by a successful Web Clipper manifest", async () => {
    const root = await makeTempDir("video-obsidian-");
    const runsDir = path.join(root, "runs");
    const noteDir = path.join(root, "vault", "Clippings");
    const notePath = path.join(noteDir, "existing.md");
    await fs.mkdir(path.join(runsDir, "2026-08-22"), { recursive: true });
    await fs.mkdir(noteDir, { recursive: true });
    await fs.writeFile(notePath, "existing");
    await fs.writeFile(
      path.join(runsDir, "2026-08-22", "manifest.json"),
      JSON.stringify({ results: [{ importedNote: { filePath: notePath } }] }),
    );

    assert.equal(
      await resolveObsidianClippingsDir({ runsDir }),
      noteDir,
    );
  });

  it("resolves the active macOS Obsidian vault without importing browser automation", async () => {
    const root = await makeTempDir("video-obsidian-macos-");
    const runsDir = path.join(root, "runs");
    const vaultDir = path.join(root, "vault");
    const configPath = path.join(root, "obsidian.json");
    await fs.mkdir(runsDir, { recursive: true });
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        vaults: {
          older: { path: path.join(root, "older-vault"), ts: 1, open: false },
          active: { path: vaultDir, ts: 2, open: true },
        },
      }),
    );

    assert.equal(
      await resolveObsidianClippingsDir({
        runsDir,
        obsidianConfigPaths: [configPath],
      }),
      path.join(vaultDir, "Clippings"),
    );
  });

  it("does not accept a regular file as an Obsidian vault", async () => {
    const root = await makeTempDir("video-obsidian-file-");
    const runsDir = path.join(root, "runs");
    const filePath = path.join(root, "not-a-vault");
    const configPath = path.join(root, "obsidian.json");
    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(filePath, "not a directory");
    await fs.writeFile(
      configPath,
      JSON.stringify({ vaults: { invalid: { path: filePath, open: true } } }),
    );

    await assert.rejects(
      resolveObsidianClippingsDir({
        runsDir,
        obsidianConfigPaths: [configPath],
      }),
      (error) => error instanceof PipelineError && error.code === "obsidian_vault_missing",
    );
  });

  it("preserves vault permission errors instead of silently choosing another vault", async () => {
    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });

    await assert.rejects(
      loadResolvedVault(["/tmp/obsidian.json"], {
        readJsonIfExistsFn: async () => ({
          vaults: {
            active: { path: "/protected/active-vault", open: true, ts: 2 },
            stale: { path: "/stale-vault", open: false, ts: 1 },
          },
        }),
        statFn: async (candidatePath) => {
          if (candidatePath === "/protected/active-vault") throw permissionError;
          return { isDirectory: () => true };
        },
      }),
      (error) => error === permissionError,
    );
  });
});
