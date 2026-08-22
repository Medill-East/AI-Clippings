import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PipelineError } from "../scripts/lib/video-channel-pipeline.js";
import {
  downloadVideoMedia,
  resolveObsidianClippingsDir,
  summarizeWithCodex,
  transcribeWithV2T,
} from "../scripts/lib/video-channel-runtime.js";

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
});
