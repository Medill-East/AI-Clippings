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
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].source, "clipboard");
    assert.equal(parsed[0].url, "https://example.com/a");
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
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, "https://example.com/a");
  });
});
