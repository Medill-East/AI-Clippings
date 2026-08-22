import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { captureWindowScreenshot } from "../scripts/lib/applescript.js";

describe("captureWindowScreenshot", () => {
  it("captures WeChat through its own screenshot overlay", () => {
    const calls = [];
    const window = { x: 10, y: 20, width: 700, height: 800 };

    captureWindowScreenshot(window, "/tmp/wechat-window.png", {
      activateWeChatFn: () => calls.push(["activate"]),
      moveMouseToPointFn: (...args) => calls.push(["move", ...args]),
      sendSystemKeystrokeFn: (...args) => calls.push(["keystroke", ...args]),
      sendSystemKeyCodeFn: (...args) => calls.push(["keycode", ...args]),
      sleepMsFn: (ms) => calls.push(["sleep", ms]),
      captureRectScreenshotFn: (...args) => calls.push(["capture", ...args]),
    });

    assert.deepEqual(calls, [
      ["activate"],
      ["sleep", 500],
      ["move", 90, 100],
      ["keystroke", "a", ["control down", "command down"]],
      ["sleep", 800],
      ["capture", window, "/tmp/wechat-window.png"],
      ["keycode", 53],
      ["sleep", 100],
      ["keycode", 53],
      ["sleep", 300],
    ]);
  });

  it("always closes the screenshot overlay when capture fails", () => {
    const calls = [];

    assert.throws(
      () =>
        captureWindowScreenshot(
          { x: 0, y: 0, width: 700, height: 800 },
          "/tmp/wechat-window.png",
          {
            activateWeChatFn: () => {},
            moveMouseToPointFn: () => {},
            sendSystemKeystrokeFn: () => {},
            sendSystemKeyCodeFn: (...args) => calls.push(["keycode", ...args]),
            sleepMsFn: () => {},
            captureRectScreenshotFn: () => {
              throw new Error("capture failed");
            },
          }
        ),
      /capture failed/
    );

    assert.deepEqual(calls, [
      ["keycode", 53],
      ["keycode", 53],
    ]);
  });
});
