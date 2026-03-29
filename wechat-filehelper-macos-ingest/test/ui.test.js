import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildUiSnapshot,
  captureVisibleUiPage,
  extractShareCardUrl,
  findFileHelperTitleLine,
  findMenuActionLine,
  mapOcrRectCenterToScreenPoint,
  probeUiEnvironment,
  scanUiLinks,
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

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.effectiveBlocks.length, 1);
    assert.equal(snapshot.effectiveItems.length, 1);
    assert.equal(snapshot.effectiveBlocks[0].timestampText, "Yesterday 18:05");
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].itemKey, snapshot.effectiveBlocks[0].blockId);
  });

  it("does not turn URL-like OCR text into fallback share cards when clipboard already has a direct URL block", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [
          {
            blockId: "block-1",
            timestampText: "Yesterday 18:05",
            rawLines: ["https://www.youtube.com/watch?v=ea81dJjF5ts"],
            rawText: "https://www.youtube.com/watch?v=ea81dJjF5ts",
            directUrls: ["https://www.youtube.com/watch?v=ea81dJjF5ts"],
            shareCardTitle: null,
            skipReason: null,
          },
        ],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "https://www.youtube.com/watch？ v=ea81dJjF5ts", x: 1016, y: 566, width: 360, height: 32 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 0);
    assert.equal(snapshot.effectiveBlocks.length, 1);
    assert.equal(snapshot.candidates.length, 0);
  });

  it("keeps true OCR-only share cards even when the same page also has direct URL blocks", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [
          {
            blockId: "block-1",
            timestampText: "Yesterday 18:05",
            rawLines: ["https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK"],
            rawText: "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
            directUrls: ["https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK"],
            shareCardTitle: null,
            skipReason: null,
          },
        ],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "https://h5-pay.xywlhlh.com/pages/ index/index?xid=2MHnK", x: 1016, y: 566, width: 360, height: 32 },
          { text: "Yesterday 18:04", x: 420, y: 690, width: 150, height: 22 },
          { text: "刚刚，飞书CLI开源，Claude", x: 1016, y: 736, width: 360, height: 32 },
          { text: "Code 也可以丝滑操控飞书节…", x: 1016, y: 776, width: 360, height: 32 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].shareCardTitle, "刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书节…");
    assert.equal(snapshot.candidates.length, 1);
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

  it("reuses a prefetched clipboard snapshot for the first visible page capture", async () => {
    let clipboardReads = 0;
    let screenshotCaptures = 0;
    const prefetchedSnapshot = {
      rawText: "Yesterday 18:05\n[Link] 第一篇文章",
      items: [
        {
          kind: "share_card",
          itemKey: "item-1",
          timestampText: "Yesterday 18:05",
          rawText: "[Link] 第一篇文章",
          title: "第一篇文章",
          skipReason: null,
        },
      ],
      stats: {
        share_cards_seen: 1,
        share_cards_unresolved: 1,
        skipped_by_rule: {},
      },
    };

    const page = await captureVisibleUiPage(
      {
        pageIndex: 0,
        prefetchedWindow: { x: 100, y: 200, width: 900, height: 700 },
        prefetchedClipboardSnapshot: prefetchedSnapshot,
        prefetchedOcrResult: {
          width: 900,
          height: 700,
          lines: [
            { text: "File Transfer", x: 240, y: 20, width: 120, height: 24 },
            { text: "第一篇文章", x: 180, y: 220, width: 180, height: 28 },
          ],
        },
      },
      {
        getFrontWeChatWindowFn: () => {
          throw new Error("should not fetch window when prefetched window exists");
        },
        captureWindowScreenshotFn: () => {
          screenshotCaptures += 1;
        },
        recognizeTextFromImageFn: async () => {
          throw new Error("should not OCR again when prefetched OCR exists");
        },
      }
    );

    assert.equal(screenshotCaptures, 0);
    assert.equal(clipboardReads, 0);
    assert.deepEqual(page.clipboardSnapshot.items, prefetchedSnapshot.items);
    assert.equal(page.clipboardSnapshot.rawText, prefetchedSnapshot.rawText);
    assert.equal(page.candidates.length, 1);
  });

  it("uses OCR-only sampling for share-card pages that do not show direct URLs", async () => {
    let clipboardReads = 0;

    const page = await captureVisibleUiPage(
      {
        pageIndex: 1,
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          return {
            rawText: "should not read",
            items: [],
            messages: [],
            blocks: [],
            stats: { share_cards_seen: 0, share_cards_unresolved: 0, skipped_by_rule: {} },
          };
        },
      },
      {
        getFrontWeChatWindowFn: () => ({ x: 100, y: 200, width: 1560, height: 1846 }),
        captureWindowScreenshotFn: () => {},
        recognizeTextFromImageFn: async () => ({
          width: 1560,
          height: 1846,
          lines: [
            { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
            { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
            { text: "刚刚，飞书CLI开源，Claude", x: 1016, y: 566, width: 360, height: 32 },
            { text: "Code 也可以丝滑操控飞书节…", x: 1016, y: 606, width: 360, height: 32 },
            { text: "给AI用的飞书", x: 1016, y: 646, width: 160, height: 24 },
          ],
        }),
      }
    );

    assert.equal(clipboardReads, 0);
    assert.equal(page.samplingMode, "ocr_only");
    assert.equal(page.candidates.length, 1);
  });

  it("reads clipboard on demand when OCR shows URL-like content", async () => {
    let clipboardReads = 0;

    const page = await captureVisibleUiPage(
      {
        pageIndex: 1,
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          return {
            rawText: "Yesterday 18:05\nhttps://example.com/article",
            items: [],
            messages: [],
            blocks: [
              {
                blockId: "block-1",
                timestampText: "Yesterday 18:05",
                rawLines: ["https://example.com/article"],
                rawText: "https://example.com/article",
                directUrls: ["https://example.com/article"],
                shareCardTitle: null,
                skipReason: null,
              },
            ],
            stats: { share_cards_seen: 0, share_cards_unresolved: 0, skipped_by_rule: {} },
          };
        },
      },
      {
        getFrontWeChatWindowFn: () => ({ x: 100, y: 200, width: 1560, height: 1846 }),
        captureWindowScreenshotFn: () => {},
        recognizeTextFromImageFn: async () => ({
          width: 1560,
          height: 1846,
          lines: [
            { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
            { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
            { text: "https://example.com/article", x: 1016, y: 566, width: 360, height: 32 },
          ],
        }),
      }
    );

    assert.equal(clipboardReads, 1);
    assert.equal(page.samplingMode, "ocr_plus_clipboard");
    assert.equal(page.clipboardSnapshot.blocks.length, 1);
  });

  it("keeps the initial UI probe on OCR-only sampling for pure share-card pages", async () => {
    let clipboardReads = 0;

    const probe = await probeUiEnvironment(
      { requireChatReady: true, returnCapturedPage: true },
      {
        isWeChatRunningFn: () => true,
        probeVisionAvailabilityFn: async () => true,
        getFrontWeChatWindowFn: () => ({ x: 100, y: 200, width: 1560, height: 1846 }),
        captureWindowScreenshotFn: () => {},
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          return {
            rawText: "should not read",
            items: [],
            messages: [],
            blocks: [],
            stats: { share_cards_seen: 0, share_cards_unresolved: 0, skipped_by_rule: {} },
          };
        },
        recognizeTextFromImageFn: async () => ({
          width: 1560,
          height: 1846,
          lines: [
            { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
            { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
            { text: "刚刚，飞书CLI开源，Claude", x: 1016, y: 566, width: 360, height: 32 },
            { text: "Code 也可以丝滑操控飞书节…", x: 1016, y: 606, width: 360, height: 32 },
            { text: "给AI用的飞书", x: 1016, y: 646, width: 160, height: 24 },
          ],
        }),
      }
    );

    assert.equal(clipboardReads, 0);
    assert.equal(probe.ui_probe_status, "ready");
    assert.equal(probe.captured_page.samplingMode, "ocr_only");
    assert.equal(probe.captured_page.clipboardSnapshot.rawText, "");
  });
});

describe("scanUiLinks", () => {
  it("keeps share-like blocks with direct URLs on the fast path without opening the viewer", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      0,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          clipboardSnapshot: {
            rawText: "Yesterday 18:05\n[Link] 直链消息\nhttps://www.youtube.com/watch?v=ea81dJjF5ts",
            blocks: [
              {
                blockId: "block-1",
                timestampText: "Yesterday 18:05",
                rawLines: [
                  "[Link] 直链消息",
                  "https://www.youtube.com/watch?v=ea81dJjF5ts",
                ],
                rawText: "[Link] 直链消息\nhttps://www.youtube.com/watch?v=ea81dJjF5ts",
                directUrls: ["https://www.youtube.com/watch?v=ea81dJjF5ts"],
                shareCardTitle: "直链消息",
                skipReason: null,
              },
            ],
            stats: {
              share_cards_seen: 1,
              share_cards_unresolved: 0,
              skipped_by_rule: {},
            },
          },
          candidateMap: new Map(),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return { status: "failed", reason: "should_not_run" };
        },
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].url, "https://www.youtube.com/watch?v=ea81dJjF5ts");
    assert.equal(result.records[0].message_type, "share_card");
    assert.equal(result.records[0].title, "直链消息");
    assert.equal(result.stats.share_cards_attempted, 0);
  });

  it("only opens the viewer for blocks that lack a direct URL", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      0,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          clipboardSnapshot: {
            rawText: [
              "Yesterday 18:05",
              "[Link] 直链消息",
              "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
              "Yesterday 18:04",
              "[Link] 纯卡片消息",
            ].join("\n"),
            blocks: [
              {
                blockId: "block-1",
                timestampText: "Yesterday 18:05",
                rawLines: [
                  "[Link] 直链消息",
                  "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
                ],
                rawText:
                  "[Link] 直链消息\nhttps://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
                directUrls: ["https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK"],
                shareCardTitle: "直链消息",
                skipReason: null,
              },
              {
                blockId: "block-2",
                timestampText: "Yesterday 18:04",
                rawLines: ["[Link] 纯卡片消息"],
                rawText: "[Link] 纯卡片消息",
                directUrls: [],
                shareCardTitle: "纯卡片消息",
                skipReason: null,
              },
            ],
            stats: {
              share_cards_seen: 2,
              share_cards_unresolved: 1,
              skipped_by_rule: {},
            },
          },
          candidateMap: new Map([
            [
              "block-2",
              {
                itemKey: "block-2",
                title: "纯卡片消息",
                clickX: 500,
                clickY: 400,
              },
            ],
          ]),
        }),
        extractShareCardUrlFn: async (candidate) => {
          extractorCalls += 1;
          assert.equal(candidate.itemKey, "block-2");
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/pure-card-123",
            usedBrowserFallback: false,
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 2);
    assert.deepEqual(
      result.records.map((record) => record.url).sort(),
      [
        "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
        "https://mp.weixin.qq.com/s/pure-card-123",
      ]
    );
    assert.equal(result.stats.share_cards_attempted, 1);
    assert.equal(result.stats.share_cards_resolved, 1);
  });

  it("deduplicates the same article across pages even when OCR raw text drifts", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      1,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => {
          captureCalls += 1;
          if (captureCalls === 1) {
            return {
              samplingMode: "ocr_only",
              clipboardSnapshot: {
                rawText: "",
                blocks: [
                  {
                    blockId: "ocr-item-0",
                    timestampText: "Yesterday 09:51",
                    rawLines: ["刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书"],
                    rawText: "刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书",
                    directUrls: [],
                    shareCardTitle: "刚刚，飞书CLI开源，Claude",
                    skipReason: null,
                  },
                ],
                stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
              },
              candidateMap: new Map([
                [
                  "ocr-item-0",
                  { itemKey: "ocr-item-0", title: "刚刚，飞书CLI开源，Claude", clickX: 500, clickY: 400 },
                ],
              ]),
            };
          }

          return {
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: "ocr-item-3",
                  timestampText: "Yesterday 09:51",
                  rawLines: ["刚刚，飞书CLI开源， Claude Code也可以丝滑操控飞书.. 给AI用的飞书"],
                  rawText: "刚刚，飞书CLI开源， Claude Code也可以丝滑操控飞书.. 给AI用的飞书",
                  directUrls: [],
                  shareCardTitle: "刚刚，飞书CLI开源， Claude",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                "ocr-item-3",
                { itemKey: "ocr-item-3", title: "刚刚，飞书CLI开源， Claude", clickX: 520, clickY: 420 },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/duplicate-article-123",
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.stats.share_cards_attempted, 1);
    assert.equal(result.stats.duplicate_skipped, 1);
  });

  it("does not deduplicate different timestamps that share a similar title", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      1,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => {
          captureCalls += 1;
          return {
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: `ocr-item-${captureCalls}`,
                  timestampText: captureCalls === 1 ? "Yesterday 09:51" : "Yesterday 09:40",
                  rawLines: ["刚刚，飞书CLI开源，Claude"],
                  rawText: "刚刚，飞书CLI开源，Claude",
                  directUrls: [],
                  shareCardTitle: "刚刚，飞书CLI开源，Claude",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-${captureCalls}`,
                { itemKey: `ocr-item-${captureCalls}`, title: "刚刚，飞书CLI开源，Claude", clickX: 500, clickY: 400 },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: `https://mp.weixin.qq.com/s/title-similar-${extractorCalls}`,
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 2);
    assert.equal(result.records.length, 2);
  });

  it("does not retry the same article after a failed extraction in the same run", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      1,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => {
          captureCalls += 1;
          return {
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: `ocr-item-${captureCalls}`,
                  timestampText: "Yesterday 09:51",
                  rawLines: ["刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书"],
                  rawText: "刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书",
                  directUrls: [],
                  shareCardTitle: "刚刚，飞书CLI开源，Claude",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-${captureCalls}`,
                { itemKey: `ocr-item-${captureCalls}`, title: "刚刚，飞书CLI开源，Claude", clickX: 500, clickY: 400 },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "failed",
            reason: "copy_link_failed",
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 0);
    assert.equal(result.stats.share_cards_attempted, 1);
    assert.equal(result.stats.share_cards_unresolved, 1);
    assert.equal(result.stats.duplicate_skipped, 1);
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

  it("retries chat recovery by navigating back to 文件传输助手 before failing", async () => {
    let windowsCall = 0;
    let verifyCalls = 0;
    let recoverCalls = 0;

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
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/recover-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => {
          verifyCalls += 1;
          return verifyCalls >= 2;
        },
        recoverChatFn: async () => {
          recoverCalls += 1;
        },
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/recover-123");
    assert.equal(recoverCalls, 1);
    assert.equal(verifyCalls, 2);
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

  it("stops menu probing early when the viewer window closes after the first miss", async () => {
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
          if (windowsCall === 2) {
            return [
              { name: "main", x: 0, y: 0, width: 800, height: 600 },
              { name: "viewer", x: 50, y: 40, width: 900, height: 700 },
            ];
          }
          return [{ name: "main", x: 0, y: 0, width: 800, height: 600 }];
        },
        getFrontWeChatWindowFn: () => ({ name: "main", x: 0, y: 0, width: 800, height: 600 }),
        captureFullScreenScreenshotFn: captureMainScreenStub,
        recognizeTextFromImageFn: async () => {
          ocrCall += 1;
          if (ocrCall === 1) {
            return {
              width: 2880,
              height: 1800,
              lines: [
                { text: "第一篇文章非常长的标题", x: 120, y: 80, width: 720, height: 42 },
                { text: "A Summary Provided by yuanbao", x: 960, y: 92, width: 330, height: 26 },
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
            lines: [{ text: "File Transfer", x: 200, y: 30, width: 180, height: 30 }],
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "viewer_detected_but_menu_not_found");
    assert.equal(ocrCall, 2);
    assert.equal(clicks.length, 2);
  });
});
