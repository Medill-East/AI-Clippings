import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  focusWeChatChatArea,
  parseClipboardText,
  readVisibleClipboardSnapshot,
  scrollUpOnce,
} from "../scripts/lib/chat.js";

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

describe("parseClipboardText", () => {
  it("groups a share-card label and direct URL into one resolved block", () => {
    const snapshot = parseClipboardText(`
Yesterday 18:05
[Link] 刚刚，飞书CLI开源，Claude
https://www.youtube.com/watch?v=ea81dJjF5ts
    `);

    assert.equal(snapshot.blocks.length, 1);
    assert.equal(snapshot.blocks[0].timestampText, "Yesterday 18:05");
    assert.equal(snapshot.blocks[0].shareCardTitle, "刚刚，飞书CLI开源，Claude");
    assert.deepEqual(snapshot.blocks[0].directUrls, ["https://www.youtube.com/watch?v=ea81dJjF5ts"]);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].kind, "text_url");
    assert.equal(snapshot.items[0].title, "刚刚，飞书CLI开源，Claude");
    assert.equal(snapshot.stats.share_cards_seen, 1);
    assert.equal(snapshot.stats.share_cards_unresolved, 0);
  });

  it("keeps arbitrary H5 links on the same message block as a direct URL path", () => {
    const snapshot = parseClipboardText(`
10:30
[Link] 某个 H5 页面
https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK
    `);

    assert.equal(snapshot.blocks.length, 1);
    assert.equal(snapshot.blocks[0].shareCardTitle, "某个 H5 页面");
    assert.deepEqual(snapshot.blocks[0].directUrls, [
      "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
    ]);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].kind, "text_url");
    assert.equal(snapshot.stats.share_cards_seen, 1);
    assert.equal(snapshot.stats.share_cards_unresolved, 0);
  });
});

describe("readVisibleClipboardSnapshot", () => {
  it("retries once when the clipboard is empty after copying visible messages", () => {
    let copies = 0;
    let reads = 0;

    const snapshot = readVisibleClipboardSnapshot(false, {
      copyVisibleMessagesFn: () => {
        copies += 1;
      },
      readClipboardTextFn: () => {
        reads += 1;
        return reads === 1 ? "" : "10:30\nhttps://example.com/article";
      },
    });

    assert.equal(copies, 2);
    assert.equal(snapshot.rawText, "10:30\nhttps://example.com/article");
    assert.equal(snapshot.blocks.length, 1);
    assert.deepEqual(snapshot.blocks[0].directUrls, ["https://example.com/article"]);
  });
});
