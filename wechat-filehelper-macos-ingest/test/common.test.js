import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeUrl,
  classifySkipReason,
  shouldSkipUrl,
  dedupeKey,
  parseWeChatTimestamp,
  mergeRecords,
  filterByTimeRange,
} from "../scripts/lib/common.js";

// ---------------------------------------------------------------------------
// canonicalizeUrl
// ---------------------------------------------------------------------------
describe("canonicalizeUrl", () => {
  it("lowercases host", () => {
    assert.equal(
      canonicalizeUrl("https://MP.WEIXIN.QQ.COM/s/abc123"),
      "https://mp.weixin.qq.com/s/abc123"
    );
  });

  it("removes fragment", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/page#section"),
      "https://example.com/page"
    );
  });

  it("removes trailing slash from path", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/foo/"),
      "https://example.com/foo"
    );
  });

  it("keeps bare origin trailing slash", () => {
    // https://example.com/ should stay as-is (path is /)
    const result = canonicalizeUrl("https://example.com/");
    assert.ok(result.startsWith("https://example.com"));
  });

  it("strips query params from WeChat article shortlinks", () => {
    const url = "https://mp.weixin.qq.com/s/abc123?chksm=xyz&from=timeline";
    assert.equal(canonicalizeUrl(url), "https://mp.weixin.qq.com/s/abc123");
  });

  it("returns raw string for invalid URLs", () => {
    assert.equal(canonicalizeUrl("not a url"), "not a url");
  });
});

// ---------------------------------------------------------------------------
// shouldSkipUrl
// ---------------------------------------------------------------------------
describe("shouldSkipUrl", () => {
  it("skips channels.weixin.qq.com (视频号)", () => {
    assert.ok(shouldSkipUrl("https://channels.weixin.qq.com/s/abc"));
  });

  it("skips bilibili.com/video/ paths", () => {
    assert.ok(shouldSkipUrl("https://www.bilibili.com/video/BV1xx4y1X7xx"));
  });

  it("skips b23.tv shortlinks", () => {
    assert.ok(shouldSkipUrl("https://b23.tv/abc123"));
  });

  it("skips wx.qq.com internal pages", () => {
    assert.ok(shouldSkipUrl("https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage"));
  });

  it("keeps bilibili column/article links", () => {
    assert.ok(!shouldSkipUrl("https://www.bilibili.com/read/cv12345"));
  });

  it("keeps WeChat article links", () => {
    assert.ok(!shouldSkipUrl("https://mp.weixin.qq.com/s/abc123"));
  });

  it("keeps arbitrary HTTPS links", () => {
    assert.ok(!shouldSkipUrl("https://example.com/article"));
  });
});

describe("classifySkipReason", () => {
  it("classifies wx.qq.com login pages as wechat_internal_login", () => {
    assert.equal(
      classifySkipReason("https://wx2.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=abc"),
      "wechat_internal_login"
    );
  });

  it("classifies b23 shortlinks separately", () => {
    assert.equal(classifySkipReason("https://b23.tv/abc123"), "bilibili_shortlink");
  });
});

// ---------------------------------------------------------------------------
// dedupeKey
// ---------------------------------------------------------------------------
describe("dedupeKey", () => {
  it("is deterministic", () => {
    const k1 = dedupeKey("文件传输助手", "2026-03-22T15:12:00.000Z", "https://mp.weixin.qq.com/s/abc");
    const k2 = dedupeKey("文件传输助手", "2026-03-22T15:12:00.000Z", "https://mp.weixin.qq.com/s/abc");
    assert.equal(k1, k2);
  });

  it("differs when URL differs", () => {
    const k1 = dedupeKey("文件传输助手", "2026-03-22T15:12:00.000Z", "https://mp.weixin.qq.com/s/abc");
    const k2 = dedupeKey("文件传输助手", "2026-03-22T15:12:00.000Z", "https://mp.weixin.qq.com/s/xyz");
    assert.notEqual(k1, k2);
  });

  it("is a 64-char hex string (SHA256)", () => {
    const k = dedupeKey("chat", "2026-01-01T00:00:00.000Z", "https://example.com");
    assert.match(k, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// parseWeChatTimestamp
// ---------------------------------------------------------------------------
describe("parseWeChatTimestamp", () => {
  // Reference: 2026-03-28T10:00:00 CST  (UTC: 2026-03-28T02:00:00Z)
  const ref = new Date("2026-03-28T02:00:00Z");

  it('parses "HH:MM" as today in CST', () => {
    const result = parseWeChatTimestamp("15:30", ref);
    // 2026-03-28 15:30 CST = 2026-03-28 07:30 UTC
    assert.equal(result?.toISOString(), "2026-03-28T07:30:00.000Z");
  });

  it('parses "昨天 HH:MM"', () => {
    const result = parseWeChatTimestamp("昨天 09:00", ref);
    // 2026-03-27 09:00 CST = 2026-03-27 01:00 UTC
    assert.equal(result?.toISOString(), "2026-03-27T01:00:00.000Z");
  });

  it('parses "今天 HH:MM"', () => {
    const result = parseWeChatTimestamp("今天 09:00", ref);
    assert.equal(result?.toISOString(), "2026-03-28T01:00:00.000Z");
  });

  it('parses "Yesterday HH:MM"', () => {
    const result = parseWeChatTimestamp("Yesterday 09:00", ref);
    assert.equal(result?.toISOString(), "2026-03-27T01:00:00.000Z");
  });

  it('parses "Today HH:MM"', () => {
    const result = parseWeChatTimestamp("Today 09:00", ref);
    assert.equal(result?.toISOString(), "2026-03-28T01:00:00.000Z");
  });

  it('parses "M月D日 HH:MM"', () => {
    const result = parseWeChatTimestamp("3月22日 15:00", ref);
    // 2026-03-22 15:00 CST = 2026-03-22 07:00 UTC
    assert.equal(result?.toISOString(), "2026-03-22T07:00:00.000Z");
  });

  it('parses "YYYY年M月D日 HH:MM"', () => {
    const result = parseWeChatTimestamp("2025年12月31日 23:59", ref);
    // 2025-12-31 23:59 CST = 2025-12-31 15:59 UTC
    assert.equal(result?.toISOString(), "2025-12-31T15:59:00.000Z");
  });

  it("returns null for empty string", () => {
    assert.equal(parseWeChatTimestamp("", ref), null);
  });

  it("returns null for unrecognized format", () => {
    assert.equal(parseWeChatTimestamp("not a date", ref), null);
  });
});

// ---------------------------------------------------------------------------
// mergeRecords
// ---------------------------------------------------------------------------
describe("mergeRecords", () => {
  const existing = [{ dedupe_key: "aaa", url: "https://a.com" }];
  const incoming = [
    { dedupe_key: "aaa", url: "https://a.com" }, // duplicate
    { dedupe_key: "bbb", url: "https://b.com" }, // new
  ];

  it("deduplicates by dedupe_key", () => {
    const merged = mergeRecords(existing, incoming);
    assert.equal(merged.length, 2);
  });

  it("preserves existing records first", () => {
    const merged = mergeRecords(existing, incoming);
    assert.equal(merged[0].dedupe_key, "aaa");
    assert.equal(merged[1].dedupe_key, "bbb");
  });
});

// ---------------------------------------------------------------------------
// filterByTimeRange
// ---------------------------------------------------------------------------
describe("filterByTimeRange", () => {
  const records = [
    { message_time: "2026-03-22T07:00:00.000Z" }, // 15:00 CST
    { message_time: "2026-03-22T08:00:00.000Z" }, // 16:00 CST
    { message_time: "2026-03-22T09:00:00.000Z" }, // 17:00 CST
  ];

  it("returns records within range (inclusive)", () => {
    const since = new Date("2026-03-22T07:00:00.000Z");
    const until = new Date("2026-03-22T08:00:00.000Z");
    const result = filterByTimeRange(records, since, until);
    assert.equal(result.length, 2);
  });

  it("excludes records outside range", () => {
    const since = new Date("2026-03-22T08:30:00.000Z");
    const until = new Date("2026-03-22T09:30:00.000Z");
    const result = filterByTimeRange(records, since, until);
    assert.equal(result.length, 1);
    assert.equal(result[0].message_time, "2026-03-22T09:00:00.000Z");
  });
});
