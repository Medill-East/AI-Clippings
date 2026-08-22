import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VideoChannelError,
  extractFeedProfile,
  parseYuanbaoPayload,
  resolveVideoChannel,
  validateSphUrl,
} from "../scripts/lib/video-channel-resolver.js";

describe("validateSphUrl", () => {
  it("accepts public WeChat Channels share links", () => {
    assert.equal(
      validateSphUrl("https://weixin.qq.com/sph/AbC123"),
      "https://weixin.qq.com/sph/AbC123",
    );
  });

  it("rejects unrelated URLs with an explicit code", () => {
    assert.throws(
      () => validateSphUrl("https://example.com/sph/AbC123"),
      (error) =>
        error instanceof VideoChannelError && error.code === "invalid_share_url",
    );
  });
});

describe("parseYuanbaoPayload", () => {
  it("extracts the temporary token and export id", () => {
    const parsed = parseYuanbaoPayload({
      code: 0,
      data: {
        playable_url:
          "https://channels.weixin.qq.com/finder-preview/pages/feed?token=token-value&eid=export-value",
        desc: "标题",
        author: "作者",
        cover_url: "https://example.test/cover.jpg",
      },
    });

    assert.deepEqual(parsed, {
      token: "token-value",
      exportId: "export-value",
      title: "标题",
      author: "作者",
      coverUrl: "https://example.test/cover.jpg",
    });
  });

  it("distinguishes an expired login from a parser rejection", () => {
    assert.throws(
      () => parseYuanbaoPayload({ code: 1001, msg: "请登录后重试" }),
      (error) => error instanceof VideoChannelError && error.code === "auth_required",
    );
    assert.throws(
      () => parseYuanbaoPayload({ code: 1002, msg: "unsupported" }),
      (error) => error instanceof VideoChannelError && error.code === "parse_rejected",
    );
  });
});

describe("extractFeedProfile", () => {
  it("selects a playable media candidate and keeps public metadata", () => {
    const result = extractFeedProfile(
      {
        errCode: 0,
        data: {
          authorInfo: { nickname: "官方作者" },
          feedInfo: {
            description: "官方标题",
            h264VideoInfo: { videoUrl: "https://media.example.test/video.mp4" },
            coverUrl: "https://media.example.test/cover.jpg",
            mediaType: 4,
            createtime: 1_700_000_000,
          },
        },
      },
      { title: "解析标题", author: "解析作者", coverUrl: "" },
    );

    assert.equal(result.videoUrl, "https://media.example.test/video.mp4");
    assert.equal(result.title, "官方标题");
    assert.equal(result.author, "官方作者");
    assert.equal(result.mediaType, 4);
  });

  it("reports media_missing instead of returning an empty URL", () => {
    assert.throws(
      () =>
        extractFeedProfile(
          { errCode: 0, data: { feedInfo: {}, authorInfo: {} } },
          { title: "", author: "", coverUrl: "" },
        ),
      (error) => error instanceof VideoChannelError && error.code === "media_missing",
    );
  });
});

describe("resolveVideoChannel", () => {
  it("verifies parser, feed, and ranged MP4 responses", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("get_feed_info")) {
        return new Response(
          JSON.stringify({
            errCode: 0,
            data: {
              authorInfo: { nickname: "作者" },
              feedInfo: {
                description: "标题",
                videoUrl: "https://media.example.test/video.mp4",
                mediaType: 4,
              },
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([0, 1, 2]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-length": "3",
          "content-range": "bytes 0-2/1000",
        },
      });
    };

    const result = await resolveVideoChannel("https://weixin.qq.com/sph/AbC123", {
      requestYuanbaoParseFn: async () => ({
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: {
            playable_url:
              "https://channels.weixin.qq.com/finder-preview/pages/feed?token=secret-token&eid=export-id",
          },
        }),
      }),
      fetchImpl,
      randomBytesFn: () => Buffer.from("01234567", "hex"),
      nowFn: () => 1_700_000_000_000,
    });

    assert.equal(result.title, "标题");
    assert.equal(result.author, "作者");
    assert.equal(result.videoUrl, "https://media.example.test/video.mp4");
    assert.match(result.urlFingerprint, /^[0-9a-f]{16}$/);
    assert.equal(result.mediaProbe.status, 206);
    assert.equal(result.mediaProbe.contentType, "video/mp4");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers.range, "bytes=0-1023");
  });

  it("reports HTTP login rejection as auth_required", async () => {
    await assert.rejects(
      resolveVideoChannel("https://weixin.qq.com/sph/AbC123", {
        requestYuanbaoParseFn: async () => ({ status: 401, text: "{}" }),
      }),
      (error) => error instanceof VideoChannelError && error.code === "auth_required",
    );
  });
});
