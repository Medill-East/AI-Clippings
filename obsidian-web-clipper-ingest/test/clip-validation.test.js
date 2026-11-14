import test from "node:test";
import assert from "node:assert/strict";
import {
  assertClipSource,
  isWeChatVerificationRedirect,
  matchesWeChatArticle,
} from "../scripts/lib/clip-validation.js";

test("rejects stale clipper state from a different article before saving", () => {
  assert.throws(() => assertClipSource("https://mp.weixin.qq.com/s/previous", ["https://mp.weixin.qq.com/s/requested"]), /does not match/);
});
test("accepts the requested or redirected source, ignoring only fragments", () => {
  assert.doesNotThrow(() => assertClipSource("https://example.com/article#content", ["https://example.com/article#top"]));
  assert.doesNotThrow(() => assertClipSource("https://example.com/canonical", ["https://example.com/short", "https://example.com/canonical"]));
});

test("rejects a captcha redirect even when it matches the current browser URL", () => {
  const captcha = "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?target_url=article";
  assert.throws(() => assertClipSource(captcha, [captcha]), /not article content/);
});

test("resumes a WeChat handoff only for the requested article", () => {
  const target = new URL("https://mp.weixin.qq.com/s?__biz=acct&mid=42&idx=1&sn=abc&scene=1#rd");
  const challenge = new URL("https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha");
  assert.equal(isWeChatVerificationRedirect(challenge, target), true);
  assert.equal(isWeChatVerificationRedirect(new URL("https://example.com/captcha"), target), false);
  assert.equal(matchesWeChatArticle(challenge, target), false);
  assert.equal(matchesWeChatArticle(new URL("https://mp.weixin.qq.com/s?__biz=acct&mid=42&idx=1&sn=abc"), target), true);
  assert.equal(matchesWeChatArticle(new URL("https://mp.weixin.qq.com/s?__biz=acct&mid=42&idx=2&sn=abc"), target), false);
});
