import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseClipboardText, scanClipboardLinks } from "../scripts/lib/chat.js";
import { runScan } from "../scripts/lib/scan.js";
import { probeWeChatStore } from "../scripts/lib/store.js";
import {
  createReadableWeChatHome,
  createUnreadableWeChatHome,
} from "./helpers/store-fixture.js";

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

describe("scan flow", () => {
  it("auto selects ui when the UI probe is ready", async () => {
    const skillRoot = await makeTempDir("wechat-filehelper-skill-");
    let capturedUiOptions = null;

    const result = await runScan(
      {
        since: new Date("2026-03-28T07:00:00.000Z"),
        until: new Date("2026-03-28T08:00:00.000Z"),
        source: "auto",
        maxScrolls: 5,
        maxCandidates: 1,
        reindex: false,
        debug: false,
      },
      {
        skillRoot,
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          reasons: [],
        }),
        scanUiLinksFn: async (...args) => {
          capturedUiOptions = args[4];
          return {
          records: [
            {
              captured_at: "2026-03-28T07:10:00.000Z",
              message_time: "2026-03-28T07:10:00.000Z",
              chat_name: "文件传输助手",
              record_type: "link",
              message_type: "share_card",
              title: "WeChat Article",
              url: "https://mp.weixin.qq.com/s/abc123",
              dedupe_key: "dedupe-ui-1",
              capture_session_id: "session-ui-1",
              source: "ui",
            },
          ],
          uncertainRecords: [
            {
              captured_at: "2026-03-28T07:11:00.000Z",
              message_time: "2026-03-28T07:11:00.000Z",
              chat_name: "文件传输助手",
              record_type: "uncertain_link",
              message_type: "text_url",
              title: "Possible OCR URL",
              url: "https://example.com/maybe",
              confidence_reason: "near_duplicate_variant",
              dedupe_key: "dedupe-ui-2",
              capture_session_id: "session-ui-1",
              source: "ui",
            },
          ],
          stats: {
            source: "ui",
            share_cards_seen: 1,
            share_cards_attempted: 1,
            share_cards_resolved: 1,
            share_cards_unresolved: 0,
            uncertain_links_total: 1,
            browser_fallback_used: 0,
              skipped_by_rule: {},
            },
          };
        },
        scanClipboardLinksFn: async () => {
          throw new Error("clipboard fallback should not run");
        },
      }
    );

    assert.equal(result.sourceSelected, "ui");
    assert.equal(result.manifest.source_selected, "ui");
    assert.equal(result.manifest.ui_probe_status, "ready");
    assert.equal(result.manifest.share_cards_attempted, 1);
    assert.equal(result.manifest.share_cards_resolved, 1);
    assert.equal(result.manifest.uncertain_links_total, 1);
    assert.equal(result.manifest.max_candidates, 1);
    assert.equal(capturedUiOptions.maxCandidates, 1);
    assert.equal(result.newRecords[0].source, "ui");
    assert.equal(result.uncertainRecords[0].record_type, "uncertain_link");
  });

  it("auto falls back to clipboard when the UI probe is not ready", async () => {
    const skillRoot = await makeTempDir("wechat-filehelper-skill-");

    const result = await runScan(
      {
        since: new Date("2026-03-28T07:00:00.000Z"),
        until: new Date("2026-03-28T08:00:00.000Z"),
        source: "auto",
        maxScrolls: 5,
        reindex: false,
        debug: false,
      },
      {
        skillRoot,
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "chat_not_ready",
          reasons: ["Current WeChat title bar OCR does not match 文件传输助手."],
        }),
        scanClipboardLinksFn: async () => ({
          records: [
            {
              captured_at: "2026-03-28T07:10:00.000Z",
              message_time: "2026-03-28T07:10:00.000Z",
              chat_name: "文件传输助手",
              message_type: "text_url",
              title: "",
              url: "https://example.com/from-clipboard",
              dedupe_key: "dedupe-1",
              capture_session_id: "session-1",
              source: "clipboard",
            },
          ],
          stats: {
            source: "clipboard",
            share_cards_seen: 1,
            share_cards_unresolved: 1,
            skipped_by_rule: { video_channel: 1 },
          },
        }),
      }
    );

    assert.equal(result.sourceSelected, "clipboard");
    assert.equal(result.manifest.source_selected, "clipboard");
    assert.equal(result.manifest.ui_probe_status, "chat_not_ready");
    assert.match(result.manifest.fallback_reason ?? "", /ui unavailable/);
    assert.equal(result.newRecords[0].source, "clipboard");
  });

  it("store scanning only runs when store is explicitly requested", async () => {
    const homeDir = await makeTempDir("wechat-filehelper-home-");
    const skillRoot = await makeTempDir("wechat-filehelper-skill-");

    const inRange = Date.parse("2026-03-28T07:30:00.000Z");
    await createReadableWeChatHome(homeDir, {
      messages: [
        {
          message_id: "m_text",
          message_time: inRange,
          content: "看看这个 https://example.com/article",
        },
        {
          message_id: "m_share",
          message_time: inRange + 60_000,
          message_type: "share_card",
          title: "WeChat Article",
          url: "https://mp.weixin.qq.com/s/abc123",
          content: "<appmsg/>",
        },
      ],
    });

    const result = await runScan(
      {
        since: new Date("2026-03-28T07:00:00.000Z"),
        until: new Date("2026-03-28T08:00:00.000Z"),
        source: "store",
        maxScrolls: 5,
        reindex: false,
        debug: false,
      },
      {
        skillRoot,
        probeWeChatStoreFn: ({ debug }) => probeWeChatStore({ homeDir, debug }),
        waitForUserReadyFn: async () => {
          throw new Error("manual ui flow should not run");
        },
        navigateToFileHelperFn: async () => {
          throw new Error("manual ui flow should not run");
        },
      }
    );

    assert.equal(result.sourceSelected, "store");
    assert.equal(result.manifest.source_selected, "store");
    assert.equal(result.manifest.store_probe_status, "readable");
    assert.equal(result.newRecords.length, 2);
    assert.ok(result.newRecords.every((record) => record.source === "store"));
  });

  it("clipboard scanning keeps text URLs and records unresolved share cards", async () => {
    const snapshots = [
      parseClipboardText(`
10:30
[链接] 文章卡片
10:29
[链接] 视频号卡片
昨天 09:00
https://example.com/visible
昨天 08:59
[链接] B站卡片 哔哩哔哩
UP主：carryonruby
播放：7483
      `),
      parseClipboardText(`
昨天 10:29
https://wx2.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=abc
昨天 10:28
https://example.com/visible
      `),
      parseClipboardText(`
昨天 10:28
https://example.com/visible
      `),
      parseClipboardText(`
昨天 10:28
https://example.com/visible
      `),
    ];

    let index = 0;
    const result = await scanClipboardLinks(
      new Date("2026-03-27T00:00:00.000Z"),
      new Date("2026-03-29T23:00:00.000Z"),
      5,
      false,
      {
        getSnapshot: () => snapshots[Math.min(index++, snapshots.length - 1)],
        scrollPage: () => {},
      }
    );

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].url, "https://example.com/visible");
    assert.equal(result.records[0].source, "clipboard");
    assert.equal(result.stats.share_cards_seen, 3);
    assert.equal(result.stats.share_cards_unresolved, 1);
    assert.equal(result.stats.skipped_by_rule.video_channel, 1);
    assert.equal(result.stats.skipped_by_rule.bilibili_video, 1);
    assert.equal(result.stats.skipped_by_rule.wechat_internal_login, 1);
    assert.equal(result.skippedRecords.length, 2);
    assert.deepEqual(
      result.skippedRecords.map((record) => record.skip_reason).sort(),
      ["bilibili_video", "wechat_internal_login"]
    );
  });

  it("store source errors when the store is unreadable", async () => {
    const homeDir = await makeTempDir("wechat-filehelper-home-");
    const skillRoot = await makeTempDir("wechat-filehelper-skill-");
    await createUnreadableWeChatHome(homeDir);

    await assert.rejects(
      () =>
        runScan(
          {
            since: new Date("2026-03-28T07:00:00.000Z"),
            until: new Date("2026-03-28T08:00:00.000Z"),
            source: "store",
            maxScrolls: 5,
            reindex: false,
            debug: false,
          },
          {
            skillRoot,
            probeWeChatStoreFn: ({ debug }) => probeWeChatStore({ homeDir, debug }),
          }
        ),
      /Store source requested but unavailable/
    );
  });
});
