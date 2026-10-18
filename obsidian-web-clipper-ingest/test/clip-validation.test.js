import test from "node:test";
import assert from "node:assert/strict";
import { assertClipSource } from "../scripts/lib/clip-validation.js";

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
