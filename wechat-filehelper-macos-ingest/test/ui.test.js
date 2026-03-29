import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildUiSnapshot,
  extractShareCardUrl,
  findFileHelperTitleLine,
  findMenuActionLine,
  mapOcrRectCenterToScreenPoint,
} from "../scripts/lib/ui.js";

const MAIN_SCREEN_BOUNDS = { x: 0, y: 0, width: 1440, height: 900 };

function captureMainScreenStub() {
  return { ...MAIN_SCREEN_BOUNDS };
}

describe("ui helpers", () => {
  it("finds 文件传输助手 in the title area", () => {
    const line = findFileHelperTitleLine(
      [
        { text: "Weixin", x: 10, y: 10, width: 80, height: 20 },
        { text: "文件传输助手", x: 200, y: 18, width: 120, height: 22 },
        { text: "第一篇文章", x: 300, y: 240, width: 160, height: 24 },
      ],
      800
    );

    assert.equal(line?.text, "文件传输助手");
  });

  it("aligns clipboard share-card candidates to OCR lines in order", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        items: [
          {
            kind: "share_card",
            itemKey: "item-1",
            timestampText: "10:30",
            rawText: "[链接] 第一篇文章",
            title: "第一篇文章",
          },
          {
            kind: "share_card",
            itemKey: "item-2",
            timestampText: "10:20",
            rawText: "[链接] 第二篇文章",
            title: "第二篇文章",
          },
        ],
      },
      ocrResult: {
        width: 900,
        height: 700,
        lines: [
          { text: "文件传输助手", x: 240, y: 20, width: 120, height: 24 },
          { text: "第一篇文章", x: 180, y: 220, width: 180, height: 28 },
          { text: "第二篇文章", x: 180, y: 330, width: 180, height: 28 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    assert.equal(snapshot.titleMatched, true);
    assert.equal(snapshot.candidates.length, 2);
    assert.equal(snapshot.candidates[0].itemKey, "item-1");
    assert.equal(snapshot.candidates[1].itemKey, "item-2");
    assert.equal(snapshot.candidates[0].clickX, 370);
    assert.equal(snapshot.candidates[0].clickY, 434);
  });

  it("falls back to OCR-only share-card discovery when clipboard has no share cards", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        items: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "刚刚，飞书 CLI 开源，Claude", x: 1016, y: 566, width: 360, height: 32 },
          { text: "Code 也可以丝滑操控飞书节…", x: 1016, y: 606, width: 360, height: 32 },
          { text: "给AI用的飞书", x: 1016, y: 646, width: 160, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackItems.length, 1);
    assert.equal(snapshot.effectiveItems.length, 1);
    assert.equal(snapshot.effectiveItems[0].timestampText, "Yesterday 18:05");
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].itemKey, snapshot.effectiveItems[0].itemKey);
  });

  it("finds copy-link menu actions from OCR output", () => {
    const line = findMenuActionLine(
      [
        { text: "添加星标", x: 10, y: 10, width: 120, height: 20 },
        { text: "复制链接", x: 10, y: 40, width: 120, height: 20 },
      ],
      ["复制链接"]
    );
    assert.equal(line?.text, "复制链接");
  });

  it("maps OCR coordinates back to screen coordinates on Retina-sized screenshots", () => {
    const point = mapOcrRectCenterToScreenPoint(
      { x: 100, y: 200, width: 780, height: 923 },
      { x: 1015.8763, y: 350.9999, width: 348.4536, height: 33 },
      { width: 1560, height: 1846 }
    );

    assert.deepEqual(point, { x: 695, y: 384 });
  });

  it("scales candidate click points when OCR image dimensions exceed window bounds", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        items: [
          {
            kind: "share_card",
            itemKey: "item-1",
            timestampText: "Yesterday 23:33",
            rawText: "[Link] Retina article",
            title: "Retina article",
          },
        ],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Retina article", x: 1016, y: 351, width: 348, height: 33 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 780, height: 923 },
    });

    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].clickX, 695);
    assert.equal(snapshot.candidates[0].clickY, 384);
  });
});

describe("extractShareCardUrl", () => {
  it("returns a URL when copy-link succeeds", async () => {
    let windowsCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async () => ({
          copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
          browserLine: null,
          ocrResult: { lines: [] },
        }),
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/abc123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.usedBrowserFallback, false);
    assert.equal(result.url, "https://mp.weixin.qq.com/s/abc123");
  });

  it("targets the newly opened viewer window even when it appears first in the window list", async () => {
    let windowsCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) {
            return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          }
          return [
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async (viewerContext) => {
          assert.equal(viewerContext.mode, "new_window");
          assert.equal(viewerContext.window.name, "viewer");
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/frontmost123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/frontmost123");
  });

  it("detects a front-window viewer transition without requiring a new window", async () => {
    let windowsCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [{ name: "main-article", x: 40, y: 20, width: 980, height: 760 }];
        },
        getFrontWeChatWindowFn: () => ({ name: "main-article", x: 40, y: 20, width: 980, height: 760 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async (viewerContext) => {
          assert.equal(viewerContext.mode, "front_window_changed");
          assert.equal(viewerContext.screenRect.width, 980);
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/front-window-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/front-window-123");
  });

  it("detects an article viewer from full-screen OCR when no new window is created", async () => {
    let menuOpened = false;
    const result = await extractShareCardUrl(
      {
        title: "安利一个11万Star的必装插件，能让你的Agent体验直接质变",
        rawText: "安利一个11万Star的必装插件，能让你的Agent体验直接质变 被AI拷打到汗流浃背",
        clickX: 500,
        clickY: 400,
      },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => [{ name: "main", x: 0, y: 0, width: 800, height: 600 }],
        getFrontWeChatWindowFn: () => ({ name: "main", x: 0, y: 0, width: 800, height: 600 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({
          width: 2880,
          height: 900,
          lines: [
            { text: "安利一个11万Star的必装插件，能让你的Agent体验", x: 120, y: 80, width: 700, height: 40 },
            { text: "原创", x: 120, y: 150, width: 70, height: 30 },
            { text: "数字生命卡兹克", x: 220, y: 150, width: 160, height: 30 },
            { text: "最近一直在聊Agent，聊Vibe Coding。", x: 120, y: 240, width: 620, height: 36 },
            { text: "但是在给越来越多的朋友安利的时候，发现其实。", x: 120, y: 300, width: 620, height: 36 },
            { text: "就是，真正卡住大多数人的，是自己没有一个标准的工作流程。", x: 120, y: 360, width: 760, height: 36 },
            { text: "特别在创造一个你想要的软件或者程序的时候。", x: 120, y: 420, width: 680, height: 36 },
          ],
        }),
        openViewerMenuFn: async (viewerContext) => {
          menuOpened = true;
          assert.equal(viewerContext.mode, "ocr_detected");
          assert.equal(viewerContext.window.name, "main");
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/in-place-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(menuOpened, true);
    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/in-place-123");
  });

  it("falls back to the browser URL when copy-link is unavailable", async () => {
    let windowsCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async () => ({
          copyLine: null,
          browserLine: { text: "使用默认浏览器打开", x: 20, y: 100, width: 180, height: 20 },
          ocrResult: { lines: [] },
        }),
        readFrontBrowserUrlFromAddressBarFn: () => "https://mp.weixin.qq.com/s/fallback123",
        readClipboardTextFn: () => "",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.usedBrowserFallback, true);
    assert.equal(result.url, "https://mp.weixin.qq.com/s/fallback123");
  });

  it("fails if the viewer cannot be closed or the chat does not recover", async () => {
    let windowsCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async () => ({
          copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
          browserLine: null,
          ocrResult: { lines: [] },
        }),
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/abc123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => false,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "viewer_not_closed");
  });

  it("clicks copy-link using full-screen OCR coordinates", async () => {
    let windowsCall = 0;
    let ocrCall = 0;
    const clicks = [];
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: (x, y) => {
          clicks.push({ x: Math.round(x), y: Math.round(y) });
        },
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => {
          ocrCall += 1;
          if (ocrCall === 1) {
            return {
              width: 2880,
              height: 1800,
              lines: [
                { text: "第一篇文章非常长的标题", x: 120, y: 80, width: 720, height: 42 },
                {
                  text: "A Summary Provided by yuanbao",
                  x: 960,
                  y: 92,
                  width: 330,
                  height: 26,
                },
                { text: "原创", x: 120, y: 148, width: 70, height: 30 },
                { text: "数字生命卡兹克", x: 220, y: 148, width: 160, height: 30 },
                { text: "最近一直在聊Agent，聊Vibe Coding。", x: 120, y: 240, width: 620, height: 36 },
                { text: "但是在给越来越多的朋友安利的时候，发现其实。", x: 120, y: 300, width: 620, height: 36 },
                { text: "就是，真正卡住大多数人的，是自己没有一个标准的工作流程。", x: 120, y: 360, width: 760, height: 36 },
                { text: "特别在创造一个你想要的软件或者程序的时候。", x: 120, y: 420, width: 680, height: 36 },
              ],
            };
          }
          return {
            width: 2880,
            height: 1800,
            lines: [{ text: "Copy Link", x: 2400, y: 280, width: 200, height: 40 }],
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/full-screen-click-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.deepEqual(clicks[1], { x: 675, y: 53 });
    assert.deepEqual(clicks.at(-1), { x: 1250, y: 150 });
  });

  it("waits for the viewer to finish loading before opening the menu", async () => {
    let windowsCall = 0;
    let ocrCall = 0;
    const result = await extractShareCardUrl(
      { title: "第一篇文章非常长的标题", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => {
          ocrCall += 1;
          if (ocrCall === 1) {
            return {
              width: 2880,
              height: 1800,
              lines: [
                { text: "Loading.....", x: 940, y: 80, width: 280, height: 30 },
                { text: "A Summary Provided by yuanbao", x: 960, y: 92, width: 330, height: 26 },
              ],
            };
          }
          return {
            width: 2880,
            height: 1800,
            lines: [
              { text: "第一篇文章非常长的标题", x: 120, y: 80, width: 720, height: 42 },
              { text: "原创", x: 120, y: 148, width: 70, height: 30 },
              { text: "数字生命卡兹克", x: 220, y: 148, width: 180, height: 30 },
              { text: "最近一直在聊Agent，聊Vibe Coding。", x: 120, y: 240, width: 620, height: 36 },
              { text: "但是在给越来越多的朋友安利的时候，发现其实。", x: 120, y: 300, width: 620, height: 36 },
              { text: "就是，真正卡住大多数人的，是自己没有一个标准的工作流程。", x: 120, y: 360, width: 760, height: 36 },
              { text: "特别在创造一个你想要的软件或者程序的时候。", x: 120, y: 420, width: 680, height: 36 },
            ],
          };
        },
        openViewerMenuFn: async (viewerContext) => {
          assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "第一篇文章非常长的标题");
          assert.equal(
            viewerContext.ocrResult.lines.some((line) => /loading/i.test(line.text)),
            false
          );
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/loading-ready-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/loading-ready-123");
  });

  it("retries the first viewer-menu point before shifting to safer nearby offsets", async () => {
    let windowsCall = 0;
    const clicks = [];
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: (x, y) => {
          clicks.push({ x: Math.round(x), y: Math.round(y) });
        },
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "main", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 50, y: 40, width: 900, height: 700 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({
          width: 2880,
          height: 1800,
          lines: [
            { text: "第一篇文章", x: 120, y: 80, width: 720, height: 42 },
            { text: "A Summary Provided by yuanbao", x: 960, y: 92, width: 330, height: 26 },
          ],
        }),
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "viewer_detected_but_menu_not_found");
    assert.deepEqual(clicks.slice(1, 6), [
      { x: 675, y: 53 },
      { x: 675, y: 53 },
      { x: 663, y: 53 },
      { x: 675, y: 48 },
      { x: 675, y: 61 },
    ]);
  });

  it("fails fast when the share-card viewer never opens", async () => {
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => [{ name: "main", x: 0, y: 0, width: 800, height: 600 }],
        getFrontWeChatWindowFn: () => ({ name: "main", x: 0, y: 0, width: 800, height: 600 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        sleepMsFn: () => {},
      }
    );

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "share_card_viewer_not_opened");
  });
});
