import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PipelineError,
  renderVideoNote,
  runVideoChannelTask,
} from "../scripts/lib/video-channel-pipeline.js";

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

const record = {
  message_time: "2026-08-22T07:30:00.000Z",
  title: "视频号卡片",
  url: "https://weixin.qq.com/sph/AbC123",
};

describe("runVideoChannelTask", () => {
  it("persists every stage and removes temporary media after a written note", async () => {
    const rootDir = await makeTempDir("video-channel-task-");
    const obsidianDir = path.join(rootDir, "vault", "Clippings");
    const observedStates = [];
    let transcriptionProfile;

    const result = await runVideoChannelTask(record, {
      rootDir,
      obsidianDir,
      resolveFn: async () => ({
        title: "真实标题\n\n#标签一 #标签二",
        author: "作者",
        videoUrl: "https://media.example.test/video.mp4",
        urlFingerprint: "1234567890abcdef",
      }),
      downloadFn: async (_profile, mediaPath) => {
        await fs.writeFile(mediaPath, "media");
        return { bytes: 5, durationSeconds: 42 };
      },
      transcribeFn: async (_mediaPath, transcriptPath, profile) => {
        transcriptionProfile = profile;
        const transcript = "这是经过本机 V2T 转写的有效内容，包含足够的信息用于后续摘要。";
        await fs.writeFile(transcriptPath, transcript, "utf8");
        return { text: transcript, provider: "v2t-local" };
      },
      summarizeFn: async () => ({
        summary: "这是一段忠于视频内容、去除口语冗余后的高质量摘要。",
        key_points: ["第一个关键事实", "第二个关键结论", "第三个可行动要点"],
      }),
      onTransition: (state) => observedStates.push(state),
    });

    assert.equal(result.state, "written");
    assert.deepEqual(observedStates, [
      "pending",
      "resolving",
      "downloading",
      "transcribing",
      "summarizing",
      "written",
    ]);
    assert.ok(result.note_path);
    const note = await fs.readFile(result.note_path, "utf8");
    assert.equal(Boolean(note), true);
    assert.match(note, /^# 真实标题$/m);
    assert.doesNotMatch(note, /^#标签一/m);
    await assert.rejects(fs.access(result.artifacts.media_path), { code: "ENOENT" });
    await assert.rejects(fs.access(result.artifacts.transcript_path), { code: "ENOENT" });

    const persisted = JSON.parse(await fs.readFile(result.task_path, "utf8"));
    assert.equal(persisted.state, "written");
    assert.equal(persisted.media_bytes, 5);
    assert.equal(persisted.transcript_chars > 0, true);
    assert.equal("video_url" in persisted, false);
    assert.equal(transcriptionProfile.durationSeconds, 42);
  });

  it("skips a second share URL that resolves to an already written video", async () => {
    const rootDir = await makeTempDir("video-channel-duplicate-");
    const obsidianDir = path.join(rootDir, "vault", "Clippings");
    const profile = {
      title: "同一个真实视频",
      author: "同一个作者",
      createTime: 1_787_220_604,
      mediaType: 4,
      videoUrl: "https://media.example.test/video.mp4?token=rotating",
      urlFingerprint: "1234567890abcdef",
    };
    let downloadCalls = 0;
    let transcribeCalls = 0;
    let summarizeCalls = 0;
    const options = {
      rootDir,
      obsidianDir,
      resolveFn: async () => profile,
      downloadFn: async (_profile, mediaPath) => {
        downloadCalls += 1;
        await fs.writeFile(mediaPath, "media");
        return { bytes: 5, durationSeconds: 42 };
      },
      transcribeFn: async (_mediaPath, transcriptPath) => {
        transcribeCalls += 1;
        const transcript = "同一个视频对应的有效逐字稿。";
        await fs.writeFile(transcriptPath, transcript, "utf8");
        return { text: transcript, provider: "v2t-local" };
      },
      summarizeFn: async () => {
        summarizeCalls += 1;
        return {
          summary: "同一个视频只应生成一份摘要和一篇 PKM 笔记。",
          key_points: ["同一媒体", "不同分享短链", "只写一次"],
        };
      },
    };

    const first = await runVideoChannelTask(record, options);
    const second = await runVideoChannelTask(
      { ...record, url: "https://weixin.qq.com/sph/Different456" },
      options,
    );

    assert.equal(first.state, "written");
    assert.equal(second.state, "skipped_duplicate");
    assert.equal(second.skipped_duplicate, true);
    assert.equal(second.duplicate_of_task_id, first.task_id);
    assert.equal(second.note_path, first.note_path);
    assert.equal(downloadCalls, 1);
    assert.equal(transcribeCalls, 1);
    assert.equal(summarizeCalls, 1);
  });

  it("records a transcribe failure with a non-empty code and failure log", async () => {
    const rootDir = await makeTempDir("video-channel-failure-");
    const obsidianDir = path.join(rootDir, "vault", "Clippings");

    const result = await runVideoChannelTask(record, {
      rootDir,
      obsidianDir,
      resolveFn: async () => ({
        title: "真实标题",
        author: "作者",
        videoUrl: "https://media.example.test/video.mp4",
        urlFingerprint: "1234567890abcdef",
      }),
      downloadFn: async (_profile, mediaPath) => {
        await fs.writeFile(mediaPath, "media");
        return { bytes: 5, durationSeconds: 42 };
      },
      transcribeFn: async () => {
        throw new PipelineError("asr_empty", "ASR returned no usable text");
      },
      summarizeFn: async () => {
        throw new Error("summarizer must not run");
      },
    });

    assert.equal(result.state, "failed");
    assert.equal(result.failed_stage, "transcribing");
    assert.equal(result.error_code, "asr_empty");
    assert.match(result.error_message, /no usable text/i);
    const failureLog = await fs.readFile(
      path.join(rootDir, "automation-failures.log"),
      "utf8",
    );
    assert.match(failureLog, /"error_code":"asr_empty"/);
  });
});

describe("renderVideoNote", () => {
  it("contains the original link, summary, and concrete key points without transcript", () => {
    const note = renderVideoNote({
      sourceUrl: record.url,
      title: "标题",
      author: "作者",
      createdAt: "2026-08-22T08:00:00.000Z",
      summary: "摘要正文",
      keyPoints: ["要点一", "要点二", "要点三"],
    });

    assert.match(note, /source: "https:\/\/weixin\.qq\.com\/sph\/AbC123"/);
    assert.match(note, /## 高质量摘要\n\n摘要正文/);
    assert.match(note, /## 关键要点\n\n- 要点一/);
    assert.doesNotMatch(note, /逐字稿/);
  });
});
