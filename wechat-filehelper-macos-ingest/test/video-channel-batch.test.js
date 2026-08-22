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
        runTaskFn: async (record) => ({
          task_id: "task-1",
          source_url: record.url,
          state: "written",
          note_path: path.join(skillRoot, "vault", "Clippings", "note.md"),
          media_bytes: 123,
          transcript_chars: 456,
          key_points_count: 4,
        }),
        nowFn: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    assert.deepEqual(result.counts, { selected: 1, written: 1, failed: 0, skipped: 0 });
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.results[0].state, "written");
    assert.equal(manifest.results[0].media_bytes, 123);
    assert.equal("video_url" in manifest.results[0], false);
    assert.equal("transcript" in manifest.results[0], false);
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
    assert.deepEqual(result.counts, { selected: 1, written: 0, failed: 1, skipped: 0 });
    assert.equal(result.results[0].error_code, "obsidian_vault_missing");
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.status, "failed");
    assert.ok(manifest.finished_at);
  });
});
