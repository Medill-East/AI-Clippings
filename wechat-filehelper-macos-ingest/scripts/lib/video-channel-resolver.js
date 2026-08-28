import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "../..");

const PARSE_URL = "https://yuanbao.tencent.com/api/weixin/get_parse_result";
const FEED_URL =
  "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";
const FEED_PAGE_URL = "https://channels.weixin.qq.com/finder-preview/pages/feed";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class VideoChannelError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "VideoChannelError";
    this.code = code;
  }
}

export function validateSphUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch (error) {
    throw new VideoChannelError(
      "invalid_share_url",
      "Video Channels share URL is invalid",
      error,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    !["weixin.qq.com", "www.weixin.qq.com"].includes(host) ||
    parts.length !== 2 ||
    parts[0].toLowerCase() !== "sph" ||
    !/^[A-Za-z0-9]+$/.test(parts[1])
  ) {
    throw new VideoChannelError(
      "invalid_share_url",
      "Only public weixin.qq.com/sph share links are supported",
    );
  }

  parsed.hash = "";
  return parsed.toString();
}

export function parseYuanbaoPayload(payload) {
  if (![0, undefined, null].includes(payload?.code)) {
    const message = String(payload?.msg ?? "");
    const code = /login|cookie|登录|鉴权/i.test(message)
      ? "auth_required"
      : "parse_rejected";
    throw new VideoChannelError(
      code,
      `Yuanbao parser returned code ${String(payload?.code)}`,
    );
  }

  const data = payload?.data ?? {};
  let playableUrl;
  try {
    playableUrl = new URL(String(data.playable_url ?? ""));
  } catch (error) {
    throw new VideoChannelError(
      "parse_rejected",
      "Yuanbao parser response is missing a valid playable URL",
      error,
    );
  }

  const token = playableUrl.searchParams.get("token");
  const exportId = playableUrl.searchParams.get("eid");
  if (!token || !exportId) {
    throw new VideoChannelError(
      "parse_rejected",
      "Yuanbao parser response is missing token or eid",
    );
  }

  return {
    token,
    exportId,
    title: String(data.desc ?? ""),
    author: String(data.author ?? ""),
    coverUrl: String(data.cover_url ?? ""),
  };
}

export function extractFeedProfile(payload, parsedMetadata) {
  if (![0, undefined, null].includes(payload?.errCode)) {
    throw new VideoChannelError(
      "feed_rejected",
      `WeChat feed returned errCode ${String(payload?.errCode)}`,
    );
  }

  const data = payload?.data ?? {};
  const feed = data.feedInfo ?? {};
  const candidates = [
    feed.videoUrl,
    feed.originVideoUrl,
    feed.h264VideoInfo?.videoUrl,
    feed.h265VideoInfo?.videoUrl,
  ];
  const videoUrl = candidates.find(
    (candidate) => typeof candidate === "string" && /^https?:\/\//i.test(candidate),
  );
  if (!videoUrl) {
    throw new VideoChannelError(
      "media_missing",
      "WeChat feed response has no downloadable media URL",
    );
  }

  return {
    videoUrl,
    title: String(feed.description || parsedMetadata.title || "微信视频号"),
    author: String(data.authorInfo?.nickname || parsedMetadata.author || ""),
    coverUrl: String(feed.coverUrl || parsedMetadata.coverUrl || ""),
    mediaType: feed.mediaType ?? null,
    createTime: feed.createtime ?? null,
  };
}

export async function resolveVideoChannel(
  shareUrl,
  {
    profileDir = path.join(skillRoot, "local/yuanbao-profile"),
    requestYuanbaoParseFn = requestYuanbaoParse,
    fetchImpl = fetch,
    randomBytesFn = randomBytes,
    nowFn = Date.now,
    feedTimeoutMs = 45_000,
    mediaProbeTimeoutMs = 30_000,
  } = {},
) {
  const normalizedShareUrl = validateSphUrl(shareUrl);
  const parserResponse = await requestYuanbaoParseFn(normalizedShareUrl, {
    profileDir,
  });

  if ([401, 403].includes(parserResponse.status)) {
    throw new VideoChannelError(
      "auth_required",
      `Yuanbao session was rejected with HTTP ${parserResponse.status}`,
    );
  }
  if (parserResponse.status !== 200) {
    throw new VideoChannelError(
      "parse_rejected",
      `Yuanbao parser returned HTTP ${parserResponse.status}`,
    );
  }

  let parserPayload;
  try {
    parserPayload = JSON.parse(String(parserResponse.text ?? ""));
  } catch (error) {
    throw new VideoChannelError(
      "parse_rejected",
      "Yuanbao parser returned non-JSON data",
      error,
    );
  }
  const parsedMetadata = parseYuanbaoPayload(parserPayload);

  const endpoint = new URL(FEED_URL);
  endpoint.searchParams.set(
    "_rid",
    `${Math.floor(nowFn() / 1000).toString(16)}-${randomBytesFn(4).toString("hex")}`,
  );
  endpoint.searchParams.set("_pageUrl", FEED_PAGE_URL);

  const referer = new URL(FEED_PAGE_URL);
  referer.searchParams.set("entry_card_type", "48");
  referer.searchParams.set("comment_scene", "39");
  referer.searchParams.set("appid", "0");
  referer.searchParams.set("token", parsedMetadata.token);
  referer.searchParams.set("entry_scene", "0");
  referer.searchParams.set("eid", parsedMetadata.exportId);

  let feedResponse;
  try {
    feedResponse = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        origin: "https://channels.weixin.qq.com",
        referer: referer.toString(),
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({
        baseReq: { generalToken: parsedMetadata.token },
        exportId: parsedMetadata.exportId,
      }),
      signal: AbortSignal.timeout(feedTimeoutMs),
    });
  } catch (error) {
    throw new VideoChannelError(
      "feed_unreachable",
      "WeChat feed request failed",
      error,
    );
  }
  if (!feedResponse.ok) {
    throw new VideoChannelError(
      "feed_rejected",
      `WeChat feed returned HTTP ${feedResponse.status}`,
    );
  }

  let feedPayload;
  try {
    feedPayload = await feedResponse.json();
  } catch (error) {
    throw new VideoChannelError(
      "feed_rejected",
      "WeChat feed returned non-JSON data",
      error,
    );
  }
  const profile = extractFeedProfile(feedPayload, parsedMetadata);

  let mediaResponse;
  try {
    mediaResponse = await fetchImpl(profile.videoUrl, {
      headers: {
        range: "bytes=0-1023",
        referer: "https://channels.weixin.qq.com/",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(mediaProbeTimeoutMs),
    });
  } catch (error) {
    throw new VideoChannelError(
      "media_unreachable",
      "Resolved media URL could not be reached",
      error,
    );
  }
  await mediaResponse.body?.cancel().catch(() => {});
  const contentType = mediaResponse.headers.get("content-type") ?? "";
  if (
    !mediaResponse.ok ||
    /^(?:image\/|text\/html)/i.test(contentType) ||
    (!/^video\//i.test(contentType) && !/octet-stream/i.test(contentType))
  ) {
    throw new VideoChannelError(
      "media_invalid",
      `Resolved media failed validation with HTTP ${mediaResponse.status} (${contentType || "unknown"})`,
    );
  }

  return {
    ...profile,
    shareUrl: normalizedShareUrl,
    urlFingerprint: createHash("sha256")
      .update(profile.videoUrl)
      .digest("hex")
      .slice(0, 16),
    mediaProbe: {
      status: mediaResponse.status,
      contentType,
      contentLength: mediaResponse.headers.get("content-length"),
      contentRangePresent: Boolean(mediaResponse.headers.get("content-range")),
    },
  };
}

export async function requestYuanbaoParse(shareUrl, { profileDir }) {
  const { chromium } = await loadPlaywright();
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      userAgent: USER_AGENT,
      viewport: { width: 1180, height: 820 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://yuanbao.tencent.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    return await page.evaluate(
      async ({ endpoint, url }) => {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "video_channel_url", url, scene: 1 }),
        });
        return { status: response.status, text: await response.text() };
      },
      { endpoint: PARSE_URL, url: shareUrl },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /ProcessSingleton|profile.*use|already in use/i.test(message)
      ? "profile_in_use"
      : "parser_unreachable";
    throw new VideoChannelError(code, "Yuanbao browser request failed", error);
  } finally {
    await context?.close().catch(() => {});
  }
}

export async function authenticateYuanbao({
  profileDir = path.join(skillRoot, "local/yuanbao-profile"),
  timeoutMs = 10 * 60_000,
} = {}) {
  const { chromium } = await loadPlaywright();
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      userAgent: USER_AGENT,
      viewport: { width: 1180, height: 820 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://yuanbao.tencent.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.bringToFront();

    const loginButton = page
      .getByRole("button", { name: /^(Log In|登录)$/i })
      .first();
    if (await loginButton.isVisible().catch(() => false)) {
      await loginButton.click();
    }

    const deadline = Date.now() + timeoutMs;
    let stableChecks = 0;
    while (Date.now() < deadline) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const loggedOutTextVisible =
        /Not logged in|未登录|请登录后输入内容|登录后输入内容/i.test(bodyText);
      const loginButtonVisible = await loginButton.isVisible().catch(() => false);
      if (!loggedOutTextVisible && !loginButtonVisible) {
        stableChecks += 1;
        if (stableChecks >= 3) return { status: "authenticated" };
      } else {
        stableChecks = 0;
      }
      await page.waitForTimeout(2_000);
    }
    throw new VideoChannelError(
      "auth_timeout",
      "Yuanbao login did not complete before the timeout",
    );
  } catch (error) {
    if (error instanceof VideoChannelError) throw error;
    throw new VideoChannelError(
      "auth_window_failed",
      "Yuanbao login window failed",
      error,
    );
  } finally {
    await context?.close().catch(() => {});
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (localError) {
    const sharedModulePath = path.resolve(
      skillRoot,
      "../obsidian-web-clipper-ingest/node_modules/playwright/index.mjs",
    );
    try {
      return await import(pathToFileURL(sharedModulePath));
    } catch (sharedError) {
      throw new VideoChannelError(
        "playwright_missing",
        "Playwright is unavailable; run npm ci in wechat-filehelper-macos-ingest",
        sharedError ?? localError,
      );
    }
  }
}
