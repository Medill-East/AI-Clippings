import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  runVideoBatch,
  selectVideoChannelRecords,
} from "../scripts/lib/video-channel-batch.js";
import { PipelineError } from "../scripts/lib/video-channel-pipeline.js";

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

describe("selectVideoChannelRecords", () => {
  const records = [
    {
      message_time: "2026-08-22T07:00:00.000Z",
      url: "https://weixin.qq.com/sph/First1",
    },
    {
      message_time: "2026-08-22T08:00:00.000Z",
      url: "https://mp.weixin.qq.com/s/Article1",
    },
    {
      message_time: "2026-08-22T09:00:00.000Z",
      url: "https://weixin.qq.com/sph/Second2",
    },
    {
      message_time: "2026-08-22T09:30:00.000Z",
      url: "https://weixin.qq.com/sph/Second2",
    },
  ];

  it("selects unique SPH links inside the requested time range", () => {
    const selected = selectVideoChannelRecords(records, {
      since: new Date("2026-08-22T06:30:00.000Z"),
      until: new Date("2026-08-22T09:15:00.000Z"),
    });
    assert.deepEqual(
      selected.map((record) => record.url),
      [
        "https://weixin.qq.com/sph/First1",
        "https://weixin.qq.com/sph/Second2",
      ],
    );
  });

  it("can select one explicit share URL without a time range", () => {
    const selected = selectVideoChannelRecords(records, {
      url: "https://weixin.qq.com/sph/Second2",
    });
    assert.equal(selected.length, 1);
    assert.equal(selected[0].url, "https://weixin.qq.com/sph/Second2");
  });

  it("selects a valid explicit share URL even when it is not in the local index", () => {
    const selected = selectVideoChannelRecords([], {
      url: "https://weixin.qq.com/sph/Direct3",
    });

    assert.deepEqual(selected, [
      {
        url: "https://weixin.qq.com/sph/Direct3",
        message_time: null,
        title: "",
        source: "explicit_url",
      },
    ]);
  });
});

describe("runVideoBatch", () => {
  it("writes a redacted manifest with independently countable outcomes", async () => {
    const skillRoot = await makeTempDir("video-batch-");
    const indexPath = path.join(skillRoot, "local", "index", "links.jsonl");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      `${JSON.stringify({
        message_time: "2026-08-22T07:00:00.000Z",
        url: "https://weixin.qq.com/sph/First1",
      })}\n`,
    );

    const result = await runVideoBatch(
      {
        skillRoot,
        url: "https://weixin.qq.com/sph/First1",
      },
      {
        resolveObsidianDirFn: async () => path.join(skillRoot, "vault", "Clippings"),
        resolveFn: async () => ({
          videoUrl: "https://media.example.test/first.mp4",
          title: "第一个视频",
          author: "作者",
          createTime: 1_787_000_000,
          mediaType: 4,
        }),
        runTaskFn: async (record) => ({
          task_id: "task-1",
          source_url: record.url,
          state: "written",
          note_path: path.join(skillRoot, "vault", "Clippings", "note.md"),
          media_bytes: 123,
          transcript_chars: 456,
          evidence_type: "visual_ocr",
          speech_transcript_chars: 3,
          visual_ocr_frames: 7,
          key_points_count: 4,
        }),
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    assert.deepEqual(result.counts, {
      selected: 1,
      unique_videos: 1,
      duplicate_links: 0,
      identity_failed_links: 0,
      written: 1,
      failed: 0,
      skipped: 0,
      not_attempted: 0,
    });
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.results[0].state, "written");
    assert.equal(manifest.results[0].media_bytes, 123);
    assert.equal(manifest.results[0].evidence_type, "visual_ocr");
    assert.equal(manifest.results[0].speech_transcript_chars, 3);
    assert.equal(manifest.results[0].visual_ocr_frames, 7);
    assert.equal("video_url" in manifest.results[0], false);
    assert.equal("transcript" in manifest.results[0], false);
  });

  it("counts a content duplicate as skipped and records its canonical task", async () => {
    const skillRoot = await makeTempDir("video-batch-duplicate-");
    const indexPath = path.join(skillRoot, "local", "index", "links.jsonl");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      ["First1", "Duplicate2"]
        .map((id) =>
          JSON.stringify({
            message_time: "2026-08-22T07:00:00.000Z",
            url: `https://weixin.qq.com/sph/${id}`,
          }),
        )
        .join("\n") + "\n",
    );

    let taskCalls = 0;
    const result = await runVideoBatch(
      {
        skillRoot,
        since: new Date("2026-08-22T06:00:00.000Z"),
        until: new Date("2026-08-22T08:00:00.000Z"),
        indexPath,
      },
      {
        resolveObsidianDirFn: async () => path.join(skillRoot, "vault", "Clippings"),
        resolveFn: async (url) => ({
          videoUrl: `https://media.example.test/${url.split("/").at(-1)}.mp4`,
          title: "同一个视频",
          author: "同一个作者",
          createTime: 1_787_000_000,
          mediaType: 4,
        }),
        runTaskFn: async (record) => {
          taskCalls += 1;
          if (taskCalls === 1) {
            return {
              task_id: "canonical-task",
              source_url: record.url,
              state: "written",
              note_path: path.join(skillRoot, "vault", "Clippings", "note.md"),
            };
          }
          return {
            task_id: "duplicate-task",
            source_url: record.url,
            state: "skipped_duplicate",
            skipped_duplicate: true,
            duplicate_of_task_id: "canonical-task",
            note_path: path.join(skillRoot, "vault", "Clippings", "note.md"),
          };
        },
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    assert.deepEqual(result.counts, {
      selected: 2,
      unique_videos: 1,
      duplicate_links: 1,
      identity_failed_links: 0,
      written: 1,
      failed: 0,
      skipped: 1,
      not_attempted: 0,
    });
    assert.equal(result.results[1].state, "skipped_duplicate");
    assert.equal(result.results[1].skipped_duplicate, true);
    assert.equal(result.results[1].duplicate_of_task_id, "canonical-task");
  });

  it("resolves share-link aliases before starting one unique video job", async () => {
    const skillRoot = await makeTempDir("video-batch-aliases-");
    const indexPath = path.join(skillRoot, "local", "index", "links.jsonl");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    const ids = ["Alias1", "Alias2", "Alias3"];
    await fs.writeFile(
      indexPath,
      `${ids
        .map((id) =>
          JSON.stringify({
            message_time: "2026-08-22T07:00:00.000Z",
            url: `https://weixin.qq.com/sph/${id}`,
          }),
        )
        .join("\n")}\n`,
    );

    const sequence = [];
    const events = [];
    let downloadCalls = 0;
    let transcribeCalls = 0;
    let summarizeCalls = 0;
    const result = await runVideoBatch(
      {
        skillRoot,
        since: new Date("2026-08-22T06:00:00.000Z"),
        until: new Date("2026-08-22T08:00:00.000Z"),
        indexPath,
      },
      {
        resolveObsidianDirFn: async () => path.join(skillRoot, "vault", "Clippings"),
        resolveFn: async (url) => {
          sequence.push(`resolve:${url.split("/").at(-1)}`);
          return {
            videoUrl: `https://media.example.test/${url.split("/").at(-1)}.mp4`,
            title: "同一个视频",
            author: "同一个作者",
            createTime: 1_787_000_000,
            mediaType: 4,
          };
        },
        downloadFn: async (_profile, mediaPath) => {
          sequence.push("download");
          downloadCalls += 1;
          await fs.mkdir(path.dirname(mediaPath), { recursive: true });
          await fs.writeFile(mediaPath, "media");
          return { bytes: 5, durationSeconds: 20 };
        },
        transcribeFn: async (_mediaPath, transcriptPath) => {
          transcribeCalls += 1;
          const text = "这是足够长的真实转写内容。";
          await fs.writeFile(transcriptPath, text);
          return { text };
        },
        summarizeFn: async () => {
          summarizeCalls += 1;
          return {
            summary: "这是忠于视频内容的摘要。",
            key_points: ["要点一", "要点二", "要点三"],
          };
        },
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
        onEvent: (event) => events.push(event),
      },
    );

    assert.deepEqual(sequence.slice(0, 3), [
      "resolve:Alias1",
      "resolve:Alias2",
      "resolve:Alias3",
    ]);
    assert.equal(downloadCalls, 1);
    assert.equal(transcribeCalls, 1);
    assert.equal(summarizeCalls, 1);
    assert.equal(result.counts.selected, 3);
    assert.equal(result.counts.unique_videos, 1);
    assert.equal(result.counts.duplicate_links, 2);
    assert.equal(result.counts.written, 1);
    assert.equal(result.counts.skipped, 2);
    assert.equal(result.results.length, 3);
    assert.ok(
      result.results
        .slice(1)
        .every((entry) => entry.state === "skipped_duplicate"),
    );
    assert.deepEqual(
      events.find((event) => event.type === "batch_prepared"),
      {
        type: "batch_prepared",
        selectedLinks: 3,
        uniqueVideos: 1,
        duplicateLinks: 2,
      },
    );
    assert.ok(
      events
        .filter((event) => event.type === "task_state")
        .every((event) => event.total === 1),
    );
  });

  it("finishes the manifest with explicit failures when the Obsidian target is unavailable", async () => {
    const skillRoot = await makeTempDir("video-batch-no-vault-");
    const indexPath = path.join(skillRoot, "local", "index", "links.jsonl");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      `${JSON.stringify({
        message_time: "2026-08-22T07:00:00.000Z",
        url: "https://weixin.qq.com/sph/First1",
      })}\n`,
    );

    const result = await runVideoBatch(
      { skillRoot, url: "https://weixin.qq.com/sph/First1" },
      {
        resolveObsidianDirFn: async () => {
          throw new PipelineError("obsidian_vault_missing", "No vault found");
        },
        runTaskFn: async () => {
          throw new Error("task must not start without an Obsidian target");
        },
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    assert.equal(result.status, "failed");
    assert.deepEqual(result.counts, {
      selected: 1,
      unique_videos: null,
      duplicate_links: null,
      identity_failed_links: 0,
      written: 0,
      failed: 1,
      skipped: 0,
      not_attempted: 0,
    });
    assert.equal(result.results[0].error_code, "obsidian_vault_missing");
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.status, "failed");
    assert.ok(manifest.finished_at);
  });

  it("stops the batch after the first auth failure and marks remaining videos as not attempted", async () => {
    const skillRoot = await makeTempDir("video-batch-auth-");
    const indexPath = path.join(skillRoot, "local", "index", "links.jsonl");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      ["First1", "Second2", "Third3"]
        .map((id) => JSON.stringify({
          message_time: "2026-08-22T07:00:00.000Z",
          url: `https://weixin.qq.com/sph/${id}`,
        }))
        .join("\n") + "\n",
    );

    let taskCalls = 0;
    const events = [];
    const result = await runVideoBatch(
      {
        skillRoot,
        since: new Date("2026-08-22T06:00:00.000Z"),
        until: new Date("2026-08-22T08:00:00.000Z"),
        indexPath,
      },
      {
        resolveObsidianDirFn: async () => path.join(skillRoot, "vault", "Clippings"),
        resolveFn: async () => {
          throw new PipelineError(
            "auth_required",
            "Yuanbao session was rejected with HTTP 401",
          );
        },
        runTaskFn: async (record) => {
          taskCalls += 1;
          return {
            task_id: `task-${taskCalls}`,
            source_url: record.url,
            state: "failed",
            failed_stage: "resolving",
            error_code: "auth_required",
            error_message: "Yuanbao session was rejected with HTTP 401",
          };
        },
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
        onEvent: (event) => events.push(event),
      },
    );

    assert.equal(taskCalls, 1);
    assert.equal(result.status, "blocked_auth");
    assert.deepEqual(result.counts, {
      selected: 3,
      unique_videos: null,
      duplicate_links: null,
      identity_failed_links: 1,
      written: 0,
      failed: 1,
      skipped: 0,
      not_attempted: 2,
    });
    assert.deepEqual(result.results.map((entry) => entry.state), [
      "failed",
      "not_attempted",
      "not_attempted",
    ]);
    assert.deepEqual(result.results.slice(1).map((entry) => entry.error_code), [
      "auth_required_not_attempted",
      "auth_required_not_attempted",
    ]);
    assert.deepEqual(events.at(-1), {
      type: "batch_blocked_auth",
      failed: 1,
      notAttempted: 2,
      recoveryCommand: "npm run video:auth",
    });
  });
});
