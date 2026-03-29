import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { focusWeChatChatArea, scrollUpOnce } from "../scripts/lib/chat.js";

describe("chat helpers", () => {
  it("retries focus until WeChat is frontmost", () => {
    const calls = [];
    let attempt = 0;

    const result = focusWeChatChatArea(false, {
      activateWeChatFn: () => calls.push("activate"),
      activateAndClickChatAreaFn: () => {
        calls.push("click");
        return `480,40${attempt}`;
      },
      getFrontmostApplicationNameFn: () => {
        attempt += 1;
        return attempt === 1 ? "Terminal" : "WeChat";
      },
      sleepMsFn: () => calls.push("sleep"),
    });

    assert.equal(result.frontmostApp, "WeChat");
    assert.equal(result.clickPoint, "480,401");
    assert.deepEqual(calls, [
      "activate",
      "sleep",
      "click",
      "sleep",
      "activate",
      "sleep",
      "click",
      "sleep",
    ]);
  });

  it("accepts an unknown frontmost app name without retrying forever", () => {
    let activateCount = 0;

    const result = focusWeChatChatArea(false, {
      activateWeChatFn: () => {
        activateCount += 1;
      },
      activateAndClickChatAreaFn: () => "484,402",
      getFrontmostApplicationNameFn: () => "",
      sleepMsFn: () => {},
    });

    assert.equal(activateCount, 1);
    assert.equal(result.clickPoint, "484,402");
    assert.equal(result.frontmostApp, "");
  });

  it("scrolls upward in small steps at the chat area instead of using Page Up", () => {
    const calls = [];

    scrollUpOnce(false, {
      focusWeChatChatAreaFn: () => ({ clickPoint: "484,402" }),
      scrollAtPointFn: (x, y, options) => calls.push({ kind: "scroll", x, y, options }),
      sendSystemKeyCodeFn: (keyCode) => calls.push({ kind: "key", keyCode }),
      sleepMsFn: () => calls.push({ kind: "sleep" }),
    });

    assert.deepEqual(calls, [
      {
        kind: "scroll",
        x: 484,
        y: 402,
        options: { lineDelta: 4, repeat: 3 },
      },
      { kind: "sleep" },
    ]);
  });

  it("falls back to small up-arrow nudges when the chat click point is unavailable", () => {
    const calls = [];

    scrollUpOnce(false, {
      focusWeChatChatAreaFn: () => ({ clickPoint: "unknown" }),
      scrollAtPointFn: () => calls.push({ kind: "scroll" }),
      sendSystemKeyCodeFn: (keyCode) => calls.push({ kind: "key", keyCode }),
      sleepMsFn: () => calls.push({ kind: "sleep" }),
    });

    assert.deepEqual(calls, [
      { kind: "key", keyCode: 126 },
      { kind: "key", keyCode: 126 },
      { kind: "key", keyCode: 126 },
      { kind: "key", keyCode: 126 },
      { kind: "key", keyCode: 126 },
      { kind: "key", keyCode: 126 },
      { kind: "sleep" },
    ]);
  });
});
