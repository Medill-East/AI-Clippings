import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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

describe("query-links.js", () => {
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

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
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

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
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

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
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
    assert.match(output, /## 待确认项/);
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

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const jsonOutput = execFileSync(
      process.execPath,
      [
        scriptPath,
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
        scriptPath,
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

    assert.match(mdOutput, /## 待确认项/);
    assert.match(mdOutput, /Possible OCR URL/);
    assert.match(mdOutput, /near_duplicate_variant/);
  });

  it("shows pending items separately from confirmed links", async () => {
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
          message_type: "share_card",
          title: "Confirmed article",
          url: "https://mp.weixin.qq.com/s/abc123",
          dedupe_key: "aaa",
          capture_session_id: "session-1",
          source: "ui",
        }),
        JSON.stringify({
          captured_at: "2026-03-28T07:11:00.000Z",
          message_time: "2026-03-28T23:59:59.000Z",
          chat_name: "文件传输助手",
          record_type: "pending_item",
          title: "刚刚，飞书CLI开源，Claude",
          raw_text: "刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书",
          pending_reason: "missing_timestamp",
          dedupe_key: "pending-1",
          capture_session_id: "session-1",
          source: "ui",
          pending_window_since: "2026-03-28T00:00:00.000Z",
          pending_window_until: "2026-03-29T23:59:59.000Z",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const jsonOutput = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--since",
        "2026-03-28T00:00:00.000Z",
        "--until",
        "2026-03-29T23:59:59.000Z",
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
    assert.equal(parsed.pending_items.length, 1);
    assert.equal(parsed.pending_items[0].pending_reason, "missing_timestamp");

    const mdOutput = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--since",
        "2026-03-28T00:00:00.000Z",
        "--until",
        "2026-03-29T23:59:59.000Z",
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

    assert.match(mdOutput, /## 待确认项/);
    assert.match(mdOutput, /刚刚，飞书CLI开源，Claude/);
    assert.match(mdOutput, /missing_timestamp/);
  });

  it("renders query range headings in China Standard Time", async () => {
    const dir = await makeTempDir("wechat-filehelper-query-");
    const indexPath = path.join(dir, "links.jsonl");
    await fs.writeFile(
      indexPath,
      [
        JSON.stringify({
          captured_at: "2026-04-10T16:10:00.000Z",
          message_time: "2026-04-10T16:10:00.000Z",
          chat_name: "文件传输助手",
          record_type: "link",
          message_type: "text_url",
          title: "CST Link",
          url: "https://example.com/cst",
          dedupe_key: "cst-1",
          capture_session_id: "session-1",
          source: "ui",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const scriptPath = "/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/scripts/query-links.js";
    const mdOutput = execFileSync(
      process.execPath,
      [
        scriptPath,
        "--since",
        "2026-04-11T00:00:00",
        "--until",
        "2026-04-11T01:00:00",
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

    assert.match(mdOutput, /2026-04-11T00:00:00\+08:00 ~ 2026-04-11T01:00:00\+08:00/);
    assert.match(mdOutput, /CST Link/);
  });
});
