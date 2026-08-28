import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runQuery } from "../scripts/lib/query.js";

const tempDirs = [];
const queryScriptPath = fileURLToPath(
  new URL("../scripts/query-links.js", import.meta.url),
);

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

describe("query-links.js", () => {
  it("routes SPH links to the background video group instead of article records", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-video-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          message_time: "2026-08-22T07:00:00.000Z",
          title: "Article",
          url: "https://mp.weixin.qq.com/s/Article1",
        }),
        JSON.stringify({
          message_time: "2026-08-22T07:01:00.000Z",
          title: "Video",
          url: "https://weixin.qq.com/sph/Video1",
        }),
      ].join("\n") + "\n",
    );

    const result = await runQuery({
      skillRoot: dir,
      indexPath,
      since: new Date("2026-08-22T06:00:00.000Z"),
      until: new Date("2026-08-22T08:00:00.000Z"),
      format: "json",
    });
    const parsed = JSON.parse(result.rendered);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.video_channels.length, 1);
    assert.equal(parsed.video_channels[0].url, "https://weixin.qq.com/sph/Video1");
  });

  it("keeps the new source field in JSON output", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-03-28T07:10:00.000Z",
          message_time: "2026-03-28T07:10:00.000Z",
          chat_name: "文件传输助手",
          message_type: "text_url",
          title: "",
          url: "https://example.com/a",
          dedupe_key: "aaa",
          capture_session_id: "session-1",
          source: "clipboard",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const output = execFileSync(
      process.execPath,
      [
        queryScriptPath,
        "--since",
        "2026-03-28T07:00:00.000Z",
        "--until",
        "2026-03-28T08:00:00.000Z",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WECHAT_FILEHELPER_INDEX_PATH: indexPath,
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.uncertain_links.length, 0);
    assert.equal(parsed.skipped_cards.length, 0);
    assert.equal(parsed.records[0].source, "clipboard");
    assert.equal(parsed.records[0].url, "https://example.com/a");
  });

  it("filters historical skipped URLs from query results", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-03-28T07:10:00.000Z",
          message_time: "2026-03-28T07:10:00.000Z",
          chat_name: "文件传输助手",
          message_type: "text_url",
          title: "",
          url: "https://example.com/a",
          dedupe_key: "aaa",
          capture_session_id: "session-1",
          source: "clipboard",
        }),
        JSON.stringify({
          captured_at: "2026-03-28T07:11:00.000Z",
          message_time: "2026-03-28T07:11:00.000Z",
          chat_name: "文件传输助手",
          message_type: "text_url",
          title: "",
          url: "https://wx2.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=abc",
          dedupe_key: "bbb",
          capture_session_id: "session-1",
          source: "clipboard",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const output = execFileSync(
      process.execPath,
      [
        queryScriptPath,
        "--since",
        "2026-03-28T07:00:00.000Z",
        "--until",
        "2026-03-28T08:00:00.000Z",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WECHAT_FILEHELPER_INDEX_PATH: indexPath,
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.uncertain_links.length, 0);
    assert.equal(parsed.records[0].url, "https://example.com/a");
  });

  it("shows skipped cards in query output as a separate group", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-03-28T07:10:00.000Z",
          message_time: "2026-03-28T07:10:00.000Z",
          chat_name: "文件传输助手",
          message_type: "text_url",
          title: "Visible Link",
          url: "https://example.com/a",
          dedupe_key: "aaa",
          capture_session_id: "session-1",
          source: "clipboard",
        }),
        JSON.stringify({
          captured_at: "2026-03-28T07:11:00.000Z",
          message_time: "2026-03-28T07:11:00.000Z",
          chat_name: "文件传输助手",
          record_type: "skipped_card",
          title: "B站视频卡片",
          raw_text: "哔哩哔哩 UP主：carryonruby 播放：7483",
          skip_reason: "bilibili_video",
          dedupe_key: "skip-1",
          capture_session_id: "session-1",
          source: "ui",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const output = execFileSync(
      process.execPath,
      [
        queryScriptPath,
        "--since",
        "2026-03-28T07:00:00.000Z",
        "--until",
        "2026-03-28T08:00:00.000Z",
        "--format",
        "md",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WECHAT_FILEHELPER_INDEX_PATH: indexPath,
        },
      }
    );

    assert.match(output, /## 已收集链接/);
    assert.match(output, /Visible Link/);
    assert.match(output, /## 待确认外链/);
    assert.match(output, /## 已跳过卡片/);
    assert.match(output, /B站视频卡片/);
    assert.match(output, /bilibili_video/);
  });

  it("shows uncertain OCR links separately from confirmed links", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-03-28T07:10:00.000Z",
          message_time: "2026-03-28T07:10:00.000Z",
          chat_name: "文件传输助手",
          record_type: "link",
          message_type: "text_url",
          title: "Confirmed",
          url: "https://example.com/a",
          dedupe_key: "aaa",
          capture_session_id: "session-1",
          source: "ui",
        }),
        JSON.stringify({
          captured_at: "2026-03-28T07:11:00.000Z",
          message_time: "2026-03-28T07:11:00.000Z",
          chat_name: "文件传输助手",
          record_type: "uncertain_link",
          message_type: "text_url",
          title: "Possible OCR URL",
          url: "https://example.com/a?maybe=1",
          confidence_reason: "near_duplicate_variant",
          dedupe_key: "bbb",
          capture_session_id: "session-1",
          source: "ui",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const jsonOutput = execFileSync(
      process.execPath,
      [
        queryScriptPath,
        "--since",
        "2026-03-28T07:00:00.000Z",
        "--until",
        "2026-03-28T08:00:00.000Z",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WECHAT_FILEHELPER_INDEX_PATH: indexPath,
        },
      }
    );

    const parsed = JSON.parse(jsonOutput);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.uncertain_links.length, 1);
    assert.equal(parsed.uncertain_links[0].confidence_reason, "near_duplicate_variant");

    const mdOutput = execFileSync(
      process.execPath,
      [
        queryScriptPath,
        "--since",
        "2026-03-28T07:00:00.000Z",
        "--until",
        "2026-03-28T08:00:00.000Z",
        "--format",
        "md",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WECHAT_FILEHELPER_INDEX_PATH: indexPath,
        },
      }
    );

    assert.match(mdOutput, /## 待确认外链/);
    assert.match(mdOutput, /Possible OCR URL/);
    assert.match(mdOutput, /near_duplicate_variant/);
  });

  it("shows image OCR content and unresolved items as separate result groups", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-content-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-08-29T07:10:00.000Z",
          message_time: "2026-08-29T07:10:00.000Z",
          chat_name: "文件传输助手",
          record_type: "content",
          content_type: "image_ocr",
          message_type: "image",
          title: "Agent 工作流检查表",
          content_text: "先验证核心假设\n失败必须明确留痕",
          content_hash: "a".repeat(64),
          ocr_confidence: 0.94,
          ocr_line_count: 2,
          pkm_status: "written",
          note_path: "/vault/Clippings/agent.md",
          dedupe_key: "image-1",
          source: "ui",
        }),
        JSON.stringify({
          captured_at: "2026-08-29T07:11:00.000Z",
          message_time: "2026-08-29T07:11:00.000Z",
          chat_name: "文件传输助手",
          record_type: "unresolved_item",
          content_type: "video_channel",
          title: "没有拿到链接的视频",
          failure_stage: "link_extraction",
          error_code: "video_share_copy_failed",
          attempt_count: 1,
          dedupe_key: "unresolved-1",
          source: "ui",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const jsonResult = await runQuery({
      skillRoot: dir,
      indexPath,
      since: new Date("2026-08-29T07:00:00.000Z"),
      until: new Date("2026-08-29T08:00:00.000Z"),
      format: "json",
    });
    const parsed = JSON.parse(jsonResult.rendered);
    assert.equal(parsed.image_contents.length, 1);
    assert.equal(parsed.image_contents[0].content_text, "先验证核心假设\n失败必须明确留痕");
    assert.equal(parsed.unresolved_items.length, 1);
    assert.equal(parsed.unresolved_items[0].error_code, "video_share_copy_failed");

    const markdownResult = await runQuery({
      skillRoot: dir,
      indexPath,
      since: new Date("2026-08-29T07:00:00.000Z"),
      until: new Date("2026-08-29T08:00:00.000Z"),
      format: "md",
    });
    assert.match(markdownResult.rendered, /## 图片 OCR/);
    assert.match(markdownResult.rendered, /Agent 工作流检查表/);
    assert.match(markdownResult.rendered, /## 未解决项/);
    assert.match(markdownResult.rendered, /video_share_copy_failed/);
  });
});
