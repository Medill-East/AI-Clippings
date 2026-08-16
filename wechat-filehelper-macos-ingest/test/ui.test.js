import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildUiSnapshot,
  captureVisibleUiPage,
  extractShareCardUrl,
  findFileHelperTitleLine,
  findMenuActionLine,
  inferShareCardItemsFromOcr,
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
          { text: "第一篇文章", x: 580, y: 220, width: 180, height: 28 },
          { text: "第二篇文章", x: 580, y: 330, width: 180, height: 28 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 900, height: 700 },
    });

    assert.equal(snapshot.titleMatched, true);
    assert.equal(snapshot.candidates.length, 2);
    assert.equal(snapshot.candidates[0].itemKey, "item-1");
    assert.equal(snapshot.candidates[1].itemKey, "item-2");
    assert.equal(snapshot.candidates[0].clickX, 770);
    assert.equal(snapshot.candidates[0].clickY, 434);
  });

  it("keeps OCR-only fallback clicks in the right chat pane when the sidebar has similar text", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        items: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "姚顺宇4小时深度访谈，我们", x: 235, y: 300, width: 320, height: 28 },
          { text: "姚顺宇4小时深度访谈，我们", x: 925, y: 496, width: 365, height: 38 },
          { text: "概括为30句话", x: 925, y: 537, width: 188, height: 32 },
          { text: "AI这个事，本来也不太", x: 925, y: 588, width: 244, height: 32 },
          { text: "人人都是产品经理", x: 966, y: 700, width: 193, height: 30 },
        ],
      },
      windowBounds: { x: 0, y: 0, width: 780, height: 923 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].matchReason, "cluster_fallback");
    assert.ok(snapshot.candidates[0].clickX > 450);
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
          { text: "Yesterday 18:05", x: 999, y: 520, width: 150, height: 22 },
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

  it("does not assign left sidebar timestamps to right-pane OCR-only cards", () => {
    const items = inferShareCardItemsFromOcr(
      [
        { text: "11:23", x: 523, y: 818, width: 54, height: 22 },
        { text: "装了这个AI热点Skill之后，", x: 928, y: 496, width: 333, height: 38 },
        { text: "你再也不需要自己去刷AI新..", x: 928, y: 537, width: 368, height: 32 },
        { text: "Agent万岁", x: 925, y: 587, width: 118, height: 30 },
      ],
      { imageWidth: 1600, imageHeight: 1800 }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].timestampText, null);
  });

  it("keeps multi-line article cards supported instead of treating them as plain text", () => {
    const items = inferShareCardItemsFromOcr(
      [
        { text: "从创意到上线全托管，单人靠", x: 928, y: 496, width: 360, height: 38 },
        { text: "AI 也能做出专业级游戏，零⋯", x: 928, y: 537, width: 360, height: 32 },
        { text: "想做游戏要全能，缺技", x: 928, y: 590, width: 240, height: 30 },
        { text: "能就卡壳；想组队没预", x: 928, y: 622, width: 240, height: 30 },
        { text: "算没资源，代码越写…", x: 928, y: 654, width: 240, height: 30 },
        { text: "AI架构之道", x: 934, y: 724, width: 132, height: 28 },
      ],
      { imageWidth: 1600, imageHeight: 1800 }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].skipReason, null);
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

  it("promotes OCR-only broken external URL fragments into direct URL blocks", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Sunday 19:31", x: 999, y: 198, width: 152, height: 28 },
          { text: "https://www.youtube.com/watch？", x: 943, y: 292, width: 445, height: 30 },
          { text: "v=ea81dJjF5ts", x: 949, y: 332, width: 193, height: 27 },
          { text: "Sunday 19:41", x: 999, y: 434, width: 155, height: 28 },
          { text: "https://h5-pay.xywlhlh.com/pages/", x: 930, y: 525, width: 461, height: 32 },
          { text: "index/index?xid=2MHnK", x: 924, y: 566, width: 324, height: 30 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    const directBlocks = snapshot.effectiveBlocks.filter((block) => (block.directUrls?.length ?? 0) > 0);
    assert.equal(directBlocks.length, 2);
    assert.deepEqual(
      directBlocks.map((block) => block.directUrls[0]),
      [
        "https://www.youtube.com/watch?v=ea81dJjF5ts",
        "https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK",
      ]
    );
    assert.equal(directBlocks[0].timestampText, "Sunday 19:31");
    assert.equal(directBlocks[1].timestampText, "Sunday 19:41");
  });

  it("keeps only the most complete OCR direct URL when fragments also produce truncated prefixes", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Sunday 19:31", x: 999, y: 198, width: 152, height: 28 },
          { text: "https://www.youtube.com/watch", x: 943, y: 252, width: 380, height: 28 },
          { text: "https://www.youtube.com/watch？", x: 943, y: 292, width: 445, height: 30 },
          { text: "v=ea81dJjF5ts", x: 949, y: 332, width: 193, height: 27 },
          { text: "Sunday 19:41", x: 999, y: 434, width: 155, height: 28 },
          { text: "https://h5-pay.xywlhlh.com/pages", x: 930, y: 485, width: 410, height: 28 },
          { text: "https://h5-pay.xywlhlh.com/pages/", x: 930, y: 525, width: 461, height: 32 },
          { text: "index/index?xid=2MHnK", x: 924, y: 566, width: 324, height: 30 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    const directBlocks = snapshot.effectiveBlocks.filter((block) => (block.directUrls?.length ?? 0) > 0);
    assert.equal(directBlocks.length, 2);
    assert.deepEqual(
      directBlocks.map((block) => block.directUrls),
      [
        ["https://www.youtube.com/watch?v=ea81dJjF5ts"],
        ["https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK"],
      ]
    );
    assert.equal(
      snapshot.effectiveBlocks[0].directUrlEntries.some(
        (entry) => entry.url === "https://www.youtube.com/watch" && entry.confidence === "uncertain"
      ),
      true
    );
    assert.equal(
      snapshot.effectiveBlocks[1].directUrlEntries.some(
        (entry) => entry.url === "https://h5-pay.xywlhlh.com/pages" && entry.confidence === "uncertain"
      ),
      true
    );
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

  it("marks bilibili-style OCR fallback cards as skipped before viewer extraction", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "哔哩哔哩", x: 1016, y: 566, width: 120, height: 32 },
          { text: "UP主：carryonruby", x: 1016, y: 606, width: 220, height: 32 },
          { text: "播放：7483", x: 1016, y: 646, width: 160, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, "bilibili_video");
    assert.equal(snapshot.candidates.length, 0);
  });

  it("marks bilibili brand-typo OCR cards as skipped before viewer extraction", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "Bolilbi 哔哩哔哩", x: 1016, y: 566, width: 220, height: 32 },
          { text: "播放：7483", x: 1016, y: 606, width: 160, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, "bilibili_video");
    assert.equal(snapshot.candidates.length, 0);
  });

  it("keeps md-titled article cards actionable while still skipping true markdown-like docs and long plain text", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "一个.md 文件让AI 学会审", x: 1016, y: 566, width: 300, height: 32 },
          { text: "美：30+大厂设计系统免费..", x: 1016, y: 606, width: 320, height: 32 },
          { text: "Awesome Design MD", x: 1016, y: 646, width: 220, height: 24 },
          { text: "Yesterday 18:04", x: 420, y: 760, width: 150, height: 22 },
          { text: "README.md", x: 1016, y: 806, width: 180, height: 32 },
          { text: "12 KB", x: 1016, y: 846, width: 80, height: 24 },
          { text: "Yesterday 18:03", x: 420, y: 930, width: 150, height: 22 },
          { text: "另外一个是关于问题的设置", x: 1016, y: 970, width: 320, height: 32 },
          { text: "这个实现其实会带来两个问题，", x: 1016, y: 1010, width: 360, height: 32 },
          { text: "因为它会绕过时间窗，还会重复打开，", x: 1016, y: 1050, width: 420, height: 32 },
          { text: "所以这类纯文本块不应该进入 viewer。", x: 1016, y: 1090, width: 440, height: 32 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 3);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, null);
    assert.equal(snapshot.ocrFallbackBlocks[1].skipReason, "markdown_doc_card");
    assert.equal(snapshot.ocrFallbackBlocks[2].skipReason, "plain_text_block");
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].title, "一个.md 文件让AI 学会审 美：30+大厂设计系统免费..");
  });

  it("keeps text-share cards actionable without treating them as plain text", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "花叔的文字分享", x: 1016, y: 566, width: 240, height: 32 },
          { text: "花了大半天把张小珺访", x: 1016, y: 606, width: 320, height: 32 },
          { text: "谈姚顺宇的4小时长访", x: 1016, y: 646, width: 300, height: 32 },
          { text: "花叔", x: 1016, y: 706, width: 80, height: 24 },
          { text: "Yesterday 18:04", x: 420, y: 820, width: 150, height: 22 },
          { text: "视频号文字分享", x: 1016, y: 866, width: 220, height: 32 },
          { text: "+关注", x: 1016, y: 906, width: 110, height: 32 },
          { text: "点赞 评论 转发", x: 1016, y: 946, width: 180, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 2);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, null);
    assert.equal(snapshot.ocrFallbackBlocks[0].cardType, "text_share_card");
    assert.equal(snapshot.ocrFallbackBlocks[1].skipReason, "video_channel");
    assert.equal(snapshot.candidates.length, 1);
    assert.equal(snapshot.candidates[0].cardType, "text_share_card");
  });

  it("marks video-channel style OCR cards as skipped before candidate generation", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "这条内容很有意思", x: 1016, y: 566, width: 320, height: 32 },
          { text: "+关注", x: 1016, y: 606, width: 110, height: 32 },
          { text: "8个朋友关注", x: 1016, y: 646, width: 180, height: 24 },
          { text: "视频号", x: 1016, y: 686, width: 100, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, "video_channel");
    assert.equal(snapshot.candidates.length, 0);
  });

  it("marks follow-heavy video-channel OCR cards as skipped even without the explicit 视频号 label", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "创业者用AI神级外挂", x: 1016, y: 566, width: 320, height: 32 },
          { text: "+关注", x: 1016, y: 606, width: 110, height: 32 },
          { text: "8个朋友关注", x: 1016, y: 646, width: 180, height: 24 },
          { text: "原声", x: 1016, y: 686, width: 80, height: 24 },
          { text: "点赞 评论 转发", x: 1016, y: 726, width: 180, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, "video_channel");
    assert.equal(snapshot.candidates.length, 0);
  });

  it("marks weak OCR fragments as skipped instead of actionable share cards", () => {
    const items = inferShareCardItemsFromOcr(
      [
        { text: "回", x: 900, y: 386, width: 26, height: 24 },
        { text: "TRAE.ai", x: 930, y: 386, width: 96, height: 24 },
        { text: "今天", x: 900, y: 520, width: 52, height: 24 },
        { text: "DnanAl Codav 十雨", x: 960, y: 520, width: 180, height: 24 },
      ],
      { imageWidth: 1440, imageHeight: 900 }
    );

    assert.equal(items.length, 2);
    assert.equal(items[0].skipReason, "weak_ocr_card");
    assert.equal(items[0].cardType, null);
    assert.equal(items[1].skipReason, "weak_ocr_card");
    assert.equal(items[1].cardType, null);
  });

  it("detects OCR share-card text that starts near the right-pane boundary", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1470,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 43, width: 172, height: 27 },
          { text: "Opus 4.8发布：41天补丁包里，", x: 845, y: 314, width: 397, height: 35 },
          { text: "Anthropic藏了一次战略转向", x: 845, y: 354, width: 357, height: 30 },
          { text: "Anthropic凌晨发了 Opus", x: 845, y: 402, width: 274, height: 27 },
          { text: "4.8。如果只看那张", x: 845, y: 437, width: 207, height: 30 },
          { text: "benchmark对比图，你会觉…", x: 845, y: 472, width: 322, height: 30 },
          { text: "1. 花叔", x: 853, y: 539, width: 86, height: 30 },
        ],
      },
      windowBounds: { x: 0, y: 0, width: 1470, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].cardType, "single_article_card");
    assert.match(snapshot.ocrFallbackBlocks[0].shareCardTitle, /Opus 4\.8/);
    assert.equal(snapshot.candidates.length, 1);
  });

  it("merges an isolated OCR article source footer back into the preceding share card", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1470,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 43, width: 172, height: 27 },
          { text: "Stefano Gualeni 什么是一个哲学游", x: 845, y: 600, width: 455, height: 35 },
          { text: "戏", x: 845, y: 640, width: 28, height: 32 },
          { text: "Watksa Hhikogtikal Game！", x: 1212, y: 700, width: 160, height: 30 },
          { text: "indienova", x: 882, y: 815, width: 155, height: 32 },
        ],
      },
      windowBounds: { x: 0, y: 0, width: 1470, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, null);
    assert.equal(snapshot.ocrFallbackBlocks[0].cardType, "single_article_card");
    assert.match(snapshot.ocrFallbackBlocks[0].shareCardTitle, /Stefano Gualeni/);
    assert.match(snapshot.ocrFallbackBlocks[0].rawText, /indienova/);
    assert.equal(snapshot.candidates.length, 1);
  });

  it("keeps a single-line article title with an isolated source footer actionable", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1470,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 43, width: 172, height: 27 },
          { text: "［Link］ 新书推荐|《论游戏》.", x: 233, y: 813, width: 327, height: 30 },
          { text: "新书推荐|《论游戏》雅克•亨里约", x: 845, y: 1336, width: 418, height: 35 },
          { text: "婴 第七艺术 ART TIME", x: 850, y: 1503, width: 247, height: 27 },
        ],
      },
      windowBounds: { x: 0, y: 0, width: 1470, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, null);
    assert.equal(snapshot.ocrFallbackBlocks[0].cardType, "single_article_card");
    assert.match(snapshot.ocrFallbackBlocks[0].shareCardTitle, /新书推荐/);
    assert.match(snapshot.ocrFallbackBlocks[0].rawText, /第七艺术 ART TIME/);
    assert.equal(snapshot.candidates.length, 1);
  });

  it("does not skip official-account articles just because the title contains video", () => {
    const snapshot = buildUiSnapshot({
      clipboardSnapshot: {
        blocks: [],
      },
      ocrResult: {
        width: 1560,
        height: 1846,
        lines: [
          { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
          { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
          { text: "视频生成游戏？AI 游戏创作平台", x: 1016, y: 566, width: 410, height: 32 },
          { text: "SOON 深度实测：你已一人成军", x: 1016, y: 606, width: 390, height: 32 },
          { text: "游戏研究社", x: 1016, y: 686, width: 120, height: 24 },
        ],
      },
      windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
    });

    assert.equal(snapshot.ocrFallbackBlocks.length, 1);
    assert.equal(snapshot.ocrFallbackBlocks[0].skipReason, null);
    assert.equal(snapshot.ocrFallbackBlocks[0].cardType, "single_article_card");
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
            { text: "第一篇文章", x: 580, y: 220, width: 180, height: 28 },
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

  it("reads clipboard when OCR only exposes a broken external URL fragment", async () => {
    let clipboardReads = 0;

    const page = await captureVisibleUiPage(
      {
        pageIndex: 1,
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          return {
            rawText: "Yesterday 18:05\nhttps://www.youtube.com/watch?v=ea81dJjF5ts",
            items: [],
            messages: [],
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
            { text: "https: //www.youtube.com/watch？ v=ea81dJjF5ts", x: 1016, y: 566, width: 420, height: 32 },
          ],
        }),
      }
    );

    assert.equal(clipboardReads, 1);
    assert.equal(page.samplingMode, "ocr_plus_clipboard");
    assert.equal(page.urlLikeSignature.includes("youtube.com"), true);
  });

  it("forces a clipboard resample once and stops early when actionable OCR blocks still have no candidates", async () => {
    let captureCalls = 0;
    let scrollCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-28T00:00:00.000Z"),
      new Date("2026-03-29T23:59:59.000Z"),
      3,
      false,
      {
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async ({ forceClipboardSnapshot = false }) => {
          captureCalls += 1;
          return {
            samplingMode: forceClipboardSnapshot ? "ocr_plus_clipboard" : "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: "ocr-item-0",
                  timestampText: "Sunday 19:31",
                  rawLines: ["刚刚，飞书CLI开源， Claude"],
                  rawText: "刚刚，飞书CLI开源， Claude",
                  directUrls: [],
                  shareCardTitle: "刚刚，飞书CLI开源， Claude",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map(),
            urlLikeSignature: "",
          };
        },
        extractShareCardUrlFn: async () => {
          throw new Error("should not open viewer when no candidates were generated");
        },
        scrollPageFn: () => {
          scrollCalls += 1;
        },
      }
    );

    assert.equal(captureCalls, 2);
    assert.equal(scrollCalls, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.stats.share_cards_attempted, 0);
    assert.equal(result.stats.share_cards_unresolved, 1);
  });

  it("does not open a share card when the generated click point is outside the right chat pane", async () => {
    let attemptedExtraction = false;
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ui-unsafe-click-"));

    const result = await scanUiLinks(
      new Date("2026-05-17T00:00:00+08:00"),
      new Date("2026-05-17T23:59:59+08:00"),
      0,
      false,
      {
        runDir,
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          window: { x: 0, y: 0, width: 780, height: 923 },
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: null,
                rawLines: ["姚顺宇4小时深度访谈，我们", "概括为30句话", "人人都是产品经理"],
                rawText: "姚顺宇4小时深度访谈，我们\n概括为30句话\n人人都是产品经理",
                directUrls: [],
                shareCardTitle: "姚顺宇4小时深度访谈，我们 概括为30句话",
                skipReason: null,
                ocrCluster: [],
              },
            ],
            stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            [
              "ocr-item-0",
              {
                itemKey: "ocr-item-0",
                blockId: "ocr-item-0",
                title: "姚顺宇4小时深度访谈，我们 概括为30句话",
                clickX: 190,
                clickY: 300,
                matchReason: "sidebar_title_match",
                line: { x: 230, y: 280, width: 320, height: 28, text: "姚顺宇4小时深度访谈，我们" },
              },
            ],
          ]),
          urlLikeSignature: "",
        }),
        extractShareCardUrlFn: async () => {
          attemptedExtraction = true;
          throw new Error("should not attempt extraction for unsafe click points");
        },
        scrollPageFn: () => {},
        nowFn: () => new Date("2026-05-17T12:00:00+08:00"),
      }
    );

    assert.equal(attemptedExtraction, false);
    assert.equal(result.records.length, 0);
    assert.equal(result.stats.share_cards_attempted, 0);
    assert.equal(result.stats.share_cards_unresolved, 1);

    const candidates = JSON.parse(
      fs.readFileSync(path.join(runDir, "artifacts", "candidates.json"), "utf8")
    );
    assert.equal(candidates[0].click_safety_status, "outside_right_chat_pane");
    assert.equal(candidates[0].match_reason, "sidebar_title_match");
    assert.deepEqual(candidates[0].screen_click_point, { x: 190, y: 300 });
    assert.deepEqual(candidates[0].window_bounds, { x: 0, y: 0, width: 780, height: 923 });
    assert.deepEqual(candidates[0].candidate_ocr_rect, {
      x: 230,
      y: 280,
      width: 320,
      height: 28,
      text: "姚顺宇4小时深度访谈，我们",
    });

    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("skips repeated clipboard reads when the next page has the same URL-like OCR signature", async () => {
    let clipboardReads = 0;
    const ocrResult = {
      width: 1560,
      height: 1846,
      lines: [
        { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
        { text: "Yesterday 18:05", x: 420, y: 520, width: 150, height: 22 },
        { text: "https: //www.youtube.com/watch？ v=ea81dJjF5ts", x: 1016, y: 566, width: 420, height: 32 },
      ],
    };

    const firstPage = await captureVisibleUiPage(
      {
        pageIndex: 1,
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          return {
            rawText: "Yesterday 18:05\nhttps://www.youtube.com/watch?v=ea81dJjF5ts",
            items: [],
            messages: [],
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
            stats: { share_cards_seen: 0, share_cards_unresolved: 0, skipped_by_rule: {} },
          };
        },
      },
      {
        getFrontWeChatWindowFn: () => ({ x: 100, y: 200, width: 1560, height: 1846 }),
        captureWindowScreenshotFn: () => {},
        recognizeTextFromImageFn: async () => ocrResult,
      }
    );

    const secondPage = await captureVisibleUiPage(
      {
        pageIndex: 2,
        previousUrlLikeSignature: firstPage.urlLikeSignature,
        readVisibleClipboardSnapshotFn: () => {
          clipboardReads += 1;
          throw new Error("clipboard should not be re-read for the same URL-like signature");
        },
      },
      {
        getFrontWeChatWindowFn: () => ({ x: 100, y: 200, width: 1560, height: 1846 }),
        captureWindowScreenshotFn: () => {},
        recognizeTextFromImageFn: async () => ocrResult,
      }
    );

    assert.equal(clipboardReads, 1);
    assert.equal(firstPage.samplingMode, "ocr_plus_clipboard");
    assert.equal(secondPage.samplingMode, "ocr_only");
    assert.equal(secondPage.urlLikeSignature, firstPage.urlLikeSignature);
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

  it("records OCR-only low-confidence external URLs as uncertain links without opening the viewer", async () => {
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
            rawText: "",
            blocks: [
              {
                blockId: "block-1",
                timestampText: "Yesterday 18:05",
                rawLines: [
                  "https://www.youtube.com/watch",
                  "https://www.youtube.com/watch?v=ea81dJjF5ts",
                ],
                rawText:
                  "https://www.youtube.com/watch\nhttps://www.youtube.com/watch?v=ea81dJjF5ts",
                directUrls: ["https://www.youtube.com/watch?v=ea81dJjF5ts"],
                directUrlEntries: [
                  {
                    url: "https://www.youtube.com/watch?v=ea81dJjF5ts",
                    confidence: "confirmed",
                    confidenceReason: "ocr_unique",
                  },
                  {
                    url: "https://www.youtube.com/watch",
                    confidence: "uncertain",
                    confidenceReason: "truncated_prefix",
                  },
                ],
                shareCardTitle: null,
                skipReason: null,
              },
            ],
            stats: {
              share_cards_seen: 0,
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
    assert.equal(result.uncertainRecords.length, 1);
    assert.equal(result.uncertainRecords[0].url, "https://www.youtube.com/watch");
    assert.equal(result.uncertainRecords[0].record_type, "uncertain_link");
    assert.equal(result.stats.uncertain_links_total, 1);
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

  it("skips bilibili video-style cards before opening the viewer", async () => {
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
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: "Yesterday 18:05",
                rawLines: ["哔哩哔哩", "UP主：carryonruby", "播放：7483"],
                rawText: "哔哩哔哩 UP主：carryonruby 播放：7483",
                directUrls: [],
                shareCardTitle: "创伤的根源",
                skipReason: "bilibili_video",
              },
            ],
            stats: {
              share_cards_seen: 1,
              share_cards_unresolved: 0,
              skipped_by_rule: { bilibili_video: 1 },
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
    assert.equal(result.records.length, 0);
    assert.equal(result.skippedRecords.length, 1);
    assert.equal(result.skippedRecords[0].record_type, "skipped_card");
    assert.equal(result.skippedRecords[0].skip_reason, "bilibili_video");
    assert.equal(result.stats.skipped_by_rule.bilibili_video, 1);
    assert.equal(result.stats.share_cards_attempted, 0);
  });

  it("does not reopen or re-record the same skipped bilibili card across pages", async () => {
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
                  timestampText: "Yesterday 18:05",
                  rawLines:
                    captureCalls === 1
                      ? ["哔哩哔哩", "UP主：carryonruby", "播放：7483"]
                      : ["Bolilbi 哔哩哔哩", "播放：7483"],
                  rawText:
                    captureCalls === 1
                      ? "哔哩哔哩 UP主：carryonruby 播放：7483"
                      : "Bolilbi 哔哩哔哩 播放：7483",
                  directUrls: [],
                  shareCardTitle: "创伤的根源",
                  skipReason: "bilibili_video",
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 0, skipped_by_rule: { bilibili_video: 1 } },
            },
            candidateMap: new Map(),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return { status: "failed", reason: "should_not_run" };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.skippedRecords.length, 1);
    assert.equal(result.stats.duplicate_skipped, 1);
  });

  it("allows a supported repeat candidate after an earlier weak OCR unsupported skip", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-31T00:00:00+08:00"),
      new Date("2026-05-31T23:59:59+08:00"),
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
                    blockId: "ocr-item-weak",
                    timestampText: "Today 09:15",
                    rawLines: ["Stefano Gualeni 什么是一个哲学游", "Watksa Hhikogtikal Game！"],
                    rawText: "Stefano Gualeni 什么是一个哲学游\nWatksa Hhikogtikal Game！",
                    directUrls: [],
                    shareCardTitle: "Stefano Gualeni 什么是一个哲学游",
                    skipReason: null,
                    cardType: null,
                    ocrCluster: [
                      { text: "Stefano Gualeni 什么是一个哲学游", x: 845, y: 600, width: 455, height: 35 },
                      { text: "Watksa Hhikogtikal Game！", x: 1212, y: 700, width: 160, height: 30 },
                    ],
                  },
                ],
                stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
              },
              candidateMap: new Map(),
            };
          }

          return {
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: "ocr-item-supported",
                  timestampText: "Today 09:15",
                  rawLines: ["Stefano Gualeni 什么是一个哲学游", "戏", "indienova"],
                  rawText: "Stefano Gualeni 什么是一个哲学游\n戏\nindienova",
                  directUrls: [],
                  shareCardTitle: "Stefano Gualeni 什么是一个哲学游 戏",
                  skipReason: null,
                  cardType: "single_article_card",
                  ocrCluster: [
                    { text: "Stefano Gualeni 什么是一个哲学游", x: 845, y: 600, width: 455, height: 35 },
                    { text: "戏", x: 845, y: 640, width: 28, height: 32 },
                    { text: "indienova", x: 882, y: 815, width: 155, height: 32 },
                  ],
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                "ocr-item-supported",
                {
                  itemKey: "ocr-item-supported",
                  title: "Stefano Gualeni 什么是一个哲学游 戏",
                  rawText: "Stefano Gualeni 什么是一个哲学游\n戏\nindienova",
                  cardType: "single_article_card",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/stefano-gualeni-123",
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].url, "https://mp.weixin.qq.com/s/stefano-gualeni-123");
  });

  it("does not reopen a repeated card after the viewer classifies it as video channel content", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-31T00:00:00+08:00"),
      new Date("2026-05-31T23:59:59+08:00"),
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
                  blockId: `ocr-item-video-${captureCalls}`,
                  timestampText: "Today 09:20",
                  rawLines: ["两个指令挖出AI眼里", "你的盲点和skill", "清华姜学长"],
                  rawText: "两个指令挖出AI眼里\n你的盲点和skill\n清华姜学长",
                  directUrls: [],
                  shareCardTitle: "两个指令挖出AI眼里 你的盲点和skill",
                  skipReason: null,
                  cardType: "single_article_card",
                  ocrCluster: [
                    { text: "两个指令挖出AI眼里", x: 845, y: 600, width: 300, height: 35 },
                    { text: "你的盲点和skill", x: 845, y: 640, width: 260, height: 32 },
                    { text: "清华姜学长", x: 882, y: 725, width: 130, height: 32 },
                  ],
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-video-${captureCalls}`,
                {
                  itemKey: `ocr-item-video-${captureCalls}`,
                  title: "两个指令挖出AI眼里 你的盲点和skill",
                  rawText: "两个指令挖出AI眼里\n你的盲点和skill\n清华姜学长",
                  cardType: "single_article_card",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "skipped",
            reason: "video_channel",
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 0);
    assert.equal(result.skippedRecords.length, 1);
    assert.equal(result.skippedRecords[0].skip_reason, "video_channel");
    assert.equal(result.stats.duplicate_skipped, 1);
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

  it("uses resolved viewer title aliases to skip a later OCR tail-only duplicate", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-31T00:00:00+08:00"),
      new Date("2026-05-31T23:59:59+08:00"),
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
                    blockId: "ocr-item-thomas-full",
                    timestampText: "Today 09:15",
                    rawLines: ["Thomas Elsaesser 模拟与不可见性"],
                    rawText: "Thomas Elsaesser 模拟与不可见性",
                    directUrls: [],
                    shareCardTitle: "Thomas Elsaesser 模拟与不可见性",
                    skipReason: null,
                    cardType: "single_article_card",
                  },
                ],
                stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
              },
              candidateMap: new Map([
                [
                  "ocr-item-thomas-full",
                  {
                    itemKey: "ocr-item-thomas-full",
                    title: "Thomas Elsaesser 模拟与不可见性",
                    rawText: "Thomas Elsaesser 模拟与不可见性",
                    cardType: "single_article_card",
                    clickX: 535,
                    clickY: 452,
                  },
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
                  blockId: "ocr-item-thomas-tail",
                  timestampText: "Today 09:15",
                  rawLines: ["的劳动：哈伦•法罗基的生活手册", "imailation and the Li"],
                  rawText: "的劳动：哈伦•法罗基的生活手册\nimailation and the Li",
                  directUrls: [],
                  shareCardTitle: "的劳动：哈伦•法罗基的生活手册 imailation and the Li",
                  skipReason: null,
                  cardType: "single_article_card",
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                "ocr-item-thomas-tail",
                {
                  itemKey: "ocr-item-thomas-tail",
                  title: "的劳动：哈伦•法罗基的生活手册 imailation and the Li",
                  rawText: "的劳动：哈伦•法罗基的生活手册\nimailation and the Li",
                  cardType: "single_article_card",
                  clickX: 535,
                  clickY: 200,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/thomas-article-123",
            usedBrowserFallback: false,
            viewerTitleLineText: "Thomas Elsaesser 模拟与不可见性的劳动：哈伦•法罗基的生活手",
            viewerH1LineText: "Thomas Elsaesser 模拟与不可见性的劳动：哈伦•法罗基的生活手",
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

  it("deduplicates OCR title drift between Elsaesser and EIsaesser", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-31T00:00:00+08:00"),
      new Date("2026-05-31T23:59:59+08:00"),
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
          const title =
            captureCalls === 1
              ? "Thomas Elsaesser 模拟与不可见性"
              : "Thomas EIsaesser 模拟与不可见性";
          return {
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: `ocr-item-thomas-${captureCalls}`,
                  timestampText: "Today 09:15",
                  rawLines: title.split(" "),
                  rawText: title,
                  directUrls: [],
                  shareCardTitle: title,
                  skipReason: null,
                  cardType: "single_article_card",
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-thomas-${captureCalls}`,
                {
                  itemKey: `ocr-item-thomas-${captureCalls}`,
                  title,
                  rawText: title,
                  cardType: "single_article_card",
                  clickX: 535,
                  clickY: 452,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/thomas-elsaesser-drift-123",
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

  it("does not retry the same article after a non-retryable copy failure in the same run", async () => {
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

  it("retries the same article after a retryable viewer readiness failure", async () => {
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
                  rawLines: ["Google 1/O 2026开发者大⋯", "量大管饱的一夜"],
                  rawText: "Google 1/O 2026开发者大⋯\n量大管饱的一夜",
                  directUrls: [],
                  shareCardTitle: "Google 1/O 2026开发者大⋯ 量大管饱的一夜",
                  skipReason: null,
                  cardType: "single_article_card",
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-${captureCalls}`,
                {
                  itemKey: `ocr-item-${captureCalls}`,
                  title: "Google 1/O 2026开发者大⋯ 量大管饱的一夜",
                  rawText: "Google 1/O 2026开发者大⋯\n量大管饱的一夜",
                  cardType: "single_article_card",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          if (extractorCalls === 1) {
            return {
              status: "failed",
              reason: "viewer_not_ready",
            };
          }
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/google-io-retry-123",
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 2);
    assert.equal(result.records.length, 1);
    assert.equal(result.stats.share_cards_attempted, 2);
    assert.equal(result.stats.share_cards_resolved, 1);
  });

  it("writes safe copy-link diagnostics into failed candidate artifacts", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ui-artifacts-"));
    try {
      const result = await scanUiLinks(
        new Date("2026-03-28T00:00:00.000Z"),
        new Date("2026-03-29T23:59:59.000Z"),
        0,
        false,
        {
          runDir,
          waitForUserReadyFn: async () => {},
          navigateToFileHelperFn: async () => {},
          probeUiEnvironmentFn: async () => ({
            ui_probe_status: "ready",
            captured_page: {},
          }),
          captureVisibleUiPageFn: async () => ({
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: "ocr-item-1",
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
                "ocr-item-1",
                { itemKey: "ocr-item-1", title: "刚刚，飞书CLI开源，Claude", clickX: 500, clickY: 400 },
              ],
            ]),
          }),
          extractShareCardUrlFn: async () => ({
            status: "failed",
            reason: "copy_link_failed",
            copyAttempts: 12,
            copyFailureReason: "clipboard_timeout",
            copyLastClipboardText: "private clipboard contents",
          }),
        }
      );

      const artifactsPath = path.join(runDir, "artifacts", "candidates.json");
      const artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
      assert.equal(result.stats.share_cards_unresolved, 1);
      assert.equal(artifacts[0].status, "unresolved");
      assert.equal(artifacts[0].copy_attempts, 12);
      assert.equal(artifacts[0].copy_failure_reason, "clipboard_timeout");
      assert.equal(artifacts[0].copy_last_clipboard, "non_url_text");
      assert.equal(JSON.stringify(artifacts).includes("private clipboard contents"), false);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("persists candidate artifacts before extraction finishes and records viewer diagnostics", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ui-artifacts-"));
    const artifactsPath = path.join(runDir, "artifacts", "candidates.json");

    try {
      const result = await scanUiLinks(
        new Date("2026-03-28T00:00:00.000Z"),
        new Date("2026-03-29T23:59:59.000Z"),
        0,
        false,
        {
          runDir,
          waitForUserReadyFn: async () => {},
          navigateToFileHelperFn: async () => {},
          probeUiEnvironmentFn: async () => ({
            ui_probe_status: "ready",
            captured_page: {},
          }),
          captureVisibleUiPageFn: async () => ({
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: [
                {
                  blockId: "ocr-item-1",
                  timestampText: "Yesterday 09:51",
                  rawLines: ["Google 1/O 2026开发者大⋯", "量大管饱的一夜"],
                  rawText: "Google 1/O 2026开发者大⋯\n量大管饱的一夜",
                  directUrls: [],
                  shareCardTitle: "Google 1/O 2026开发者大⋯ 量大管饱的一夜",
                  skipReason: null,
                  cardType: "single_article_card",
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                "ocr-item-1",
                {
                  itemKey: "ocr-item-1",
                  title: "Google 1/O 2026开发者大⋯ 量大管饱的一夜",
                  rawText: "Google 1/O 2026开发者大⋯\n量大管饱的一夜",
                  cardType: "single_article_card",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          }),
          extractShareCardUrlFn: async () => {
            assert.equal(fs.existsSync(artifactsPath), true);
            const duringExtraction = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
            assert.equal(duringExtraction[0].status, "pending");
            return {
              status: "failed",
              reason: "viewer_not_ready",
              viewerReadyState: "loading",
              viewerTitleLineText: "帮大家总结了一下凌晨的Google 1/O",
              viewerArticleShellLoaded: true,
              viewerContentLines: 0,
              viewerMetadataLines: 3,
            };
          },
        }
      );

      const artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
      assert.equal(result.stats.share_cards_unresolved, 1);
      assert.equal(artifacts[0].status, "unresolved");
      assert.equal(artifacts[0].reason, "viewer_not_ready");
      assert.equal(artifacts[0].viewer_ready_state, "loading");
      assert.equal(artifacts[0].viewer_title_line_text, "帮大家总结了一下凌晨的Google 1/O");
      assert.equal(artifacts[0].viewer_article_shell_loaded, true);
      assert.equal(artifacts[0].viewer_content_lines, 0);
      assert.equal(artifacts[0].viewer_metadata_lines, 3);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("keeps untimed OCR-only articles out of formal results and deduplicates them across pages", async () => {
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
                  timestampText: null,
                  rawLines:
                    captureCalls === 1
                      ? ["全链路 AIPPT神器：牛马打工 人有救了"]
                      : ["全链路 AIPPT神器： 牛马打工"],
                  rawText:
                    captureCalls === 1
                      ? "全链路 AIPPT神器：牛马打工 人有救了"
                      : "全链路 AIPPT神器： 牛马打工",
                  directUrls: [],
                  shareCardTitle:
                    captureCalls === 1
                      ? "全链路 AIPPT神器：牛马打工 人有救了"
                      : "全链路 AIPPT神器： 牛马打工",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-${captureCalls}`,
                {
                  itemKey: `ocr-item-${captureCalls}`,
                  title:
                    captureCalls === 1
                      ? "全链路 AIPPT神器：牛马打工 人有救了"
                      : "全链路 AIPPT神器： 牛马打工",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/untimed-duplicate-1",
            usedBrowserFallback: false,
            timings: {
              viewer_open_wait_ms: 10,
              viewer_ready_wait_ms: 20,
              viewer_menu_wait_ms: 30,
              viewer_copy_wait_ms: 40,
              viewer_close_wait_ms: 50,
            },
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.pendingRecords.length, 1);
    assert.equal(result.pendingRecords[0].record_type, "pending_item");
    assert.equal(result.pendingRecords[0].pending_reason, "missing_timestamp");
    assert.equal(result.stats.duplicate_skipped, 1);
  });

  it("opens untimed supported OCR-only articles when the scan run time is inside the requested window", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-09T23:00:00+08:00"),
      new Date("2026-05-10T23:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-10T11:25:11+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: null,
                rawLines: ["装了这个AI热点Skill之后，", "你再也不需要自己去刷AI新..", "Agent万岁"],
                rawText: "装了这个AI热点Skill之后，\n你再也不需要自己去刷AI新..\nAgent万岁",
                directUrls: [],
                shareCardTitle: "装了这个AI热点Skill之后， 你再也不需要自己去刷AI新..",
                skipReason: null,
                ocrCluster: [
                  { text: "装了这个AI热点Skill之后，", x: 928, y: 496, width: 333, height: 38 },
                ],
              },
            ],
            stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            [
              "ocr-item-0",
              {
                itemKey: "ocr-item-0",
                title: "装了这个AI热点Skill之后， 你再也不需要自己去刷AI新..",
                clickX: 500,
                clickY: 400,
              },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/batch-forward-untimed-1",
            usedBrowserFallback: false,
            timings: {
              viewer_open_wait_ms: 10,
              viewer_ready_wait_ms: 20,
              viewer_menu_wait_ms: 30,
              viewer_copy_wait_ms: 40,
              viewer_close_wait_ms: 50,
            },
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.records[0].time_confidence, "window_assumed");
    assert.equal(result.records[0].message_time, "2026-05-10T03:25:11.000Z");
  });

  it("opens untimed supported OCR-only articles for same-day windows even after the window has ended", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-17T00:00:00+08:00"),
      new Date("2026-05-17T11:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-17T12:27:53+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: null,
                rawLines: ["姚顺宇4小时深度访谈，我们", "概括为30句话", "人人都是产品经理"],
                rawText: "姚顺宇4小时深度访谈，我们\n概括为30句话\n人人都是产品经理",
                directUrls: [],
                shareCardTitle: "姚顺宇4小时深度访谈，我们 概括为30句话",
                skipReason: null,
                ocrCluster: [
                  { text: "姚顺宇4小时深度访谈，我们", x: 1016, y: 566, width: 360, height: 32 },
                ],
              },
            ],
            stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            [
              "ocr-item-0",
              {
                itemKey: "ocr-item-0",
                title: "姚顺宇4小时深度访谈，我们 概括为30句话",
                clickX: 500,
                clickY: 400,
              },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/same-day-window-assumed-1",
            usedBrowserFallback: false,
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.records[0].time_confidence, "window_assumed");
    assert.equal(result.records[0].message_time, "2026-05-17T03:59:59.000Z");
  });

  it("keeps untimed supported OCR-only articles pending for historical windows outside the scan day", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-16T00:00:00+08:00"),
      new Date("2026-05-16T23:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-17T12:27:53+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: null,
                rawLines: ["姚顺宇4小时深度访谈，我们", "概括为30句话", "人人都是产品经理"],
                rawText: "姚顺宇4小时深度访谈，我们\n概括为30句话\n人人都是产品经理",
                directUrls: [],
                shareCardTitle: "姚顺宇4小时深度访谈，我们 概括为30句话",
                skipReason: null,
                cardType: "single_article_card",
                ocrCluster: [
                  { text: "姚顺宇4小时深度访谈，我们", x: 1016, y: 566, width: 360, height: 32 },
                ],
              },
            ],
            stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            [
              "ocr-item-0",
              {
                itemKey: "ocr-item-0",
                title: "姚顺宇4小时深度访谈，我们 概括为30句话",
                cardType: "single_article_card",
                clickX: 500,
                clickY: 400,
              },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return { status: "failed", reason: "should_not_run" };
        },
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.pendingRecords.length, 1);
    assert.equal(result.pendingRecords[0].pending_reason, "missing_timestamp");
  });

  it("skips unsupported OCR-only image, symbol, and plain-text blocks instead of opening them", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-17T00:00:00+08:00"),
      new Date("2026-05-17T23:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-17T12:27:53+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: "Today 11:03",
                rawLines: ["◎ ©④"],
                rawText: "◎ ©④",
                directUrls: [],
                shareCardTitle: "◎ ©④",
                skipReason: null,
                cardType: null,
                ocrCluster: [{ text: "◎ ©④", x: 1016, y: 566, width: 120, height: 32 }],
              },
              {
                blockId: "ocr-item-1",
                timestampText: "Today 11:04",
                rawLines: ["一张图片", "Image", "Photo"],
                rawText: "一张图片\nImage\nPhoto",
                directUrls: [],
                shareCardTitle: "一张图片",
                skipReason: null,
                cardType: null,
                ocrCluster: [{ text: "一张图片", x: 1016, y: 666, width: 180, height: 32 }],
              },
              {
                blockId: "ocr-item-2",
                timestampText: "Today 11:05",
                rawLines: [
                  "这是一段普通文字，里面有很多描述。",
                  "它不是链接卡片，也不是公众号来源。",
                  "继续写几句只是为了形成长文本块。",
                ],
                rawText:
                  "这是一段普通文字，里面有很多描述。\n它不是链接卡片，也不是公众号来源。\n继续写几句只是为了形成长文本块。",
                directUrls: [],
                shareCardTitle: "这是一段普通文字，里面有很多描述。",
                skipReason: null,
                cardType: null,
                ocrCluster: [
                  { text: "这是一段普通文字，里面有很多描述。", x: 1016, y: 766, width: 460, height: 32 },
                ],
              },
            ],
            stats: { share_cards_seen: 3, share_cards_unresolved: 3, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            ["ocr-item-0", { itemKey: "ocr-item-0", title: "◎ ©④", clickX: 500, clickY: 400 }],
            ["ocr-item-1", { itemKey: "ocr-item-1", title: "一张图片", clickX: 500, clickY: 500 }],
            [
              "ocr-item-2",
              { itemKey: "ocr-item-2", title: "这是一段普通文字，里面有很多描述。", clickX: 500, clickY: 600 },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return { status: "failed", reason: "should_not_run" };
        },
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.skippedRecords.length, 3);
    assert.deepEqual(
      result.skippedRecords.map((record) => record.skip_reason).sort(),
      ["image_card", "plain_text_block", "weak_ocr_card"]
    );
  });

  it("opens text-share OCR-only cards as supported records inside the requested window", async () => {
    let extractorCalls = 0;
    let snapshot = null;

    const result = await scanUiLinks(
      new Date("2026-05-17T00:00:00+08:00"),
      new Date("2026-05-17T23:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-17T11:03:00+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => {
          snapshot = buildUiSnapshot({
            clipboardSnapshot: { rawText: "", blocks: [] },
            ocrResult: {
              width: 1560,
              height: 1846,
              lines: [
                { text: "File Transfer", x: 630, y: 50, width: 190, height: 30 },
                { text: "花叔的文字分享", x: 1016, y: 566, width: 240, height: 32 },
                { text: "花了大半天把张小珺访", x: 1016, y: 606, width: 320, height: 32 },
                { text: "谈姚顺宇的4小时长访", x: 1016, y: 646, width: 300, height: 32 },
                { text: "花叔", x: 1016, y: 706, width: 80, height: 24 },
              ],
            },
            windowBounds: { x: 100, y: 200, width: 1560, height: 1846 },
          });

          return {
            window: { x: 100, y: 200, width: 1560, height: 1846 },
            samplingMode: "ocr_only",
            clipboardSnapshot: {
              rawText: "",
              blocks: snapshot.effectiveBlocks,
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map(snapshot.candidates.map((candidate) => [candidate.itemKey, candidate])),
          };
        },
        extractShareCardUrlFn: async (candidate) => {
          extractorCalls += 1;
          assert.equal(candidate.cardType, "text_share_card");
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/text-share-window-assumed-1",
            usedBrowserFallback: false,
            timings: {
              viewer_open_wait_ms: 10,
              viewer_ready_wait_ms: 20,
              viewer_menu_wait_ms: 30,
              viewer_copy_wait_ms: 40,
              viewer_close_wait_ms: 50,
            },
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].message_type, "text_share");
    assert.equal(result.records[0].time_confidence, "window_assumed");
    assert.equal(result.pendingRecords.length, 0);
  });

  it("does not collapse different text-share cards that share the same author header", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-05-17T00:00:00+08:00"),
      new Date("2026-05-17T23:59:59+08:00"),
      0,
      false,
      {
        nowFn: () => new Date("2026-05-17T11:03:00+08:00"),
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
        probeUiEnvironmentFn: async () => ({
          ui_probe_status: "ready",
          captured_page: {},
        }),
        captureVisibleUiPageFn: async () => ({
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: null,
                rawLines: ["花叔的文字分享", "花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。", "花叔"],
                rawText: "花叔的文字分享\n花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。\n花叔",
                directUrls: [],
                shareCardTitle: "花叔的文字分享",
                skipReason: null,
                cardType: "text_share_card",
                ocrCluster: [{ text: "花叔的文字分享", x: 1016, y: 566, width: 240, height: 32 }],
              },
              {
                blockId: "ocr-item-1",
                timestampText: null,
                rawLines: ["花叔的文字分享", "观察了三年，我把所有人用AI的水平分成了10个等级。", "花叔"],
                rawText: "花叔的文字分享\n观察了三年，我把所有人用AI的水平分成了10个等级。\n花叔",
                directUrls: [],
                shareCardTitle: "花叔的文字分享",
                skipReason: null,
                cardType: "text_share_card",
                ocrCluster: [{ text: "花叔的文字分享", x: 1016, y: 866, width: 240, height: 32 }],
              },
            ],
            stats: { share_cards_seen: 2, share_cards_unresolved: 2, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            ["ocr-item-0", { itemKey: "ocr-item-0", title: "花叔的文字分享", rawText: "花叔的文字分享\n花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。\n花叔", cardType: "text_share_card", clickX: 500, clickY: 400 }],
            ["ocr-item-1", { itemKey: "ocr-item-1", title: "花叔的文字分享", rawText: "花叔的文字分享\n观察了三年，我把所有人用AI的水平分成了10个等级。\n花叔", cardType: "text_share_card", clickX: 500, clickY: 700 }],
          ]),
        }),
        extractShareCardUrlFn: async (candidate) => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: `https://mp.weixin.qq.com/s/text-share-${candidate.itemKey}`,
            usedBrowserFallback: false,
          };
        },
      }
    );

    assert.equal(extractorCalls, 2);
    assert.equal(result.records.length, 2);
    assert.equal(result.stats.duplicate_skipped, 0);
  });

  it("infers a nearby timestamp for supported OCR-only articles before opening the viewer", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-29T00:00:00+08:00"),
      new Date("2026-03-29T23:59:59+08:00"),
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
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: "Today 09:51",
                rawLines: ["前一条有时间"],
                rawText: "前一条有时间",
                directUrls: [],
                shareCardTitle: null,
                skipReason: null,
              },
              {
                blockId: "ocr-item-1",
                timestampText: null,
                rawLines: ["刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书"],
                rawText: "刚刚，飞书CLI开源，Claude Code 也可以丝滑操控飞书",
                directUrls: [],
                shareCardTitle: "刚刚，飞书CLI开源，Claude",
                skipReason: null,
                cardType: "single_article_card",
                ocrCluster: [
                  { text: "刚刚，飞书CLI开源，Claude", x: 1016, y: 620, width: 360, height: 32 },
                ],
              },
            ],
            stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
          },
          candidateMap: new Map([
            [
              "ocr-item-1",
              { itemKey: "ocr-item-1", title: "刚刚，飞书CLI开源，Claude", clickX: 500, clickY: 400 },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/inferred-timestamp-1",
            usedBrowserFallback: false,
            timings: {
              viewer_open_wait_ms: 10,
              viewer_ready_wait_ms: 20,
              viewer_menu_wait_ms: 30,
              viewer_copy_wait_ms: 40,
              viewer_close_wait_ms: 50,
            },
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.stats.share_cards_attempted, 1);
    assert.equal(result.records[0].url, "https://mp.weixin.qq.com/s/inferred-timestamp-1");
  });

  it("infers a grouped timestamp for supported OCR-only articles even when a skipped block sits between them", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-29T00:00:00+08:00"),
      new Date("2026-03-29T23:59:59+08:00"),
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
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: "Today 09:51",
                rawLines: ["上一条同组文章"],
                rawText: "上一条同组文章",
                directUrls: [],
                shareCardTitle: "上一条同组文章",
                skipReason: null,
                ocrCluster: [{ text: "上一条同组文章", x: 1016, y: 520, width: 260, height: 32 }],
              },
              {
                blockId: "ocr-item-1",
                timestampText: null,
                rawLines: ["+关注", "8个朋友关注", "原声"],
                rawText: "+关注 8个朋友关注 原声",
                directUrls: [],
                shareCardTitle: "创业者用AI神级外挂",
                skipReason: "video_channel",
                ocrCluster: [{ text: "创业者用AI神级外挂", x: 1016, y: 620, width: 320, height: 32 }],
              },
              {
                blockId: "ocr-item-2",
                timestampText: null,
                rawLines: ["暴雪前首席创意官：我们无法", "决定一款游戏是否能长久，…", "游戏研究社"],
                rawText: "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，… 游戏研究社",
                directUrls: [],
                shareCardTitle: "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，…",
                skipReason: null,
                ocrCluster: [{ text: "暴雪前首席创意官：我们无法", x: 1016, y: 760, width: 360, height: 32 }],
              },
            ],
            stats: { share_cards_seen: 3, share_cards_unresolved: 1, skipped_by_rule: { video_channel: 1 } },
          },
          candidateMap: new Map([
            [
              "ocr-item-2",
              {
                itemKey: "ocr-item-2",
                title: "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，…",
                clickX: 500,
                clickY: 400,
              },
            ],
          ]),
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/inferred-timestamp-grouped-1",
            usedBrowserFallback: false,
            timings: {
              viewer_open_wait_ms: 10,
              viewer_ready_wait_ms: 20,
              viewer_menu_wait_ms: 30,
              viewer_copy_wait_ms: 40,
              viewer_close_wait_ms: 50,
            },
          };
        },
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.records[0].url, "https://mp.weixin.qq.com/s/inferred-timestamp-grouped-1");
  });

  it("does not open OCR-only cards that are outside the requested time range", async () => {
    let extractorCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-29T00:00:00+08:00"),
      new Date("2026-03-29T23:59:59+08:00"),
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
          samplingMode: "ocr_only",
          clipboardSnapshot: {
            rawText: "",
            blocks: [
              {
                blockId: "ocr-item-0",
                timestampText: "Yesterday 18:05",
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
        }),
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return { status: "failed", reason: "should_not_run" };
        },
      }
    );

    assert.equal(extractorCalls, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.pendingRecords.length, 0);
    assert.equal(result.stats.share_cards_attempted, 0);
  });

  it("deduplicates multi-line articles across pages even when the inferred timestamp drifts slightly", async () => {
    let extractorCalls = 0;
    let captureCalls = 0;

    const result = await scanUiLinks(
      new Date("2026-03-29T00:00:00+08:00"),
      new Date("2026-03-29T23:59:59+08:00"),
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
                  timestampText: captureCalls === 1 ? "Today 23:17" : "Today 23:18",
                  rawLines:
                    captureCalls === 1
                      ? ["暴雪前首席创意官：我们无法", "决定一款游戏是否能长久，…", "游戏研究社"]
                      : ["暴雪前首席创意官：我们无法", "决定一款游戏是否能长久，⋯", "游戏研究社"],
                  rawText:
                    captureCalls === 1
                      ? "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，… 游戏研究社"
                      : "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，⋯ 游戏研究社",
                  directUrls: [],
                  shareCardTitle: "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，…",
                  skipReason: null,
                },
              ],
              stats: { share_cards_seen: 1, share_cards_unresolved: 1, skipped_by_rule: {} },
            },
            candidateMap: new Map([
              [
                `ocr-item-${captureCalls}`,
                {
                  itemKey: `ocr-item-${captureCalls}`,
                  title: "暴雪前首席创意官：我们无法 决定一款游戏是否能长久，…",
                  clickX: 500,
                  clickY: 400,
                },
              ],
            ]),
          };
        },
        extractShareCardUrlFn: async () => {
          extractorCalls += 1;
          return {
            status: "ok",
            url: "https://mp.weixin.qq.com/s/blizzard-duplicate-1",
            usedBrowserFallback: false,
          };
        },
        scrollPageFn: () => {},
      }
    );

    assert.equal(extractorCalls, 1);
    assert.equal(result.records.length, 1);
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
    assert.ok(result.timings);
    assert.equal(typeof result.timings.viewer_open_wait_ms, "number");
  });

  it("waits longer for copy-link to populate the clipboard", async () => {
    let windowsCall = 0;
    let now = 1_000;
    let clipboardReads = 0;
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
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
          readClipboardTextFn: () => {
            clipboardReads += 1;
            return now >= 1_560 ? "https://mp.weixin.qq.com/s/delayed-copy-123" : "";
          },
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/delayed-copy-123");
      assert.equal(result.copyAttempts >= 15, true);
      assert.equal(result.copyFailureReason, null);
      assert.equal(clipboardReads >= result.copyAttempts, true);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("opens the menu for Remedy when metadata appears after a multi-line H1", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        {
          title: "从Remedy、10到拉瑞安，为什么 很多中型工作室坚持用自研引擎开..",
          rawText: "从Remedy、10到拉瑞安，为什么\n很多中型工作室坚持用自研引擎开..\n触乐",
          cardType: "single_article_card",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "从Remedy、1O到拉瑞安，为1 ×", x: 608, y: 93, width: 446, height: 36 },
              {
                text: "从Remedy、10到拉瑞安，为什么很多中型工作室坚持用自研引擎开",
                x: 111,
                y: 192,
                width: 1365,
                height: 60,
              },
              { text: "发游戏？|触乐", x: 111, y: 251.8, width: 342, height: 55.5 },
              { text: "原创 等等", x: 111, y: 340.8, width: 157, height: 38.5 },
              { text: "触乐 2026年5月11日 18:00", x: 111, y: 345.7, width: 424, height: 29 },
              {
                text: "游戏引擎与关卡设计、玩法机制一样，都是游戏作为一种艺术形式的重要组成部分。",
                x: 143,
                y: 1634.6,
                width: 1390,
                height: 44,
              },
            ],
          }),
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(
              viewerContext.ocrAnalysis.titleLine?.text,
              "从Remedy、10到拉瑞安，为什么很多中型工作室坚持用自研引擎开"
            );
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/remedy-engine-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/remedy-engine-123");
      assert.equal(result.viewerArticleShellLoaded, true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("uses the H1 instead of the 游戏艺术设计 subtitle when the viewer is loaded", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        {
          title: "游戏艺术设计是个好专业吗？ 一条走了二十年的路",
          rawText: "一条走了二十年的路\n游戏茶馆",
          cardType: "single_article_card",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "游戏艺术设计是个好专业吗？", x: 608, y: 93, width: 432, height: 36 },
              { text: "游戏艺术设计是个好专业吗？", x: 111, y: 192, width: 526, height: 51 },
              { text: "原创 茶馆小二儿 游戏茶馆 2026年6月12日 15:50|", x: 111, y: 281.7, width: 760, height: 30 },
              { text: "一条走了二十年的路", x: 111, y: 546, width: 397, height: 45 },
              { text: "游戏艺术设计这个专业，走到今天已经二十年了。", x: 111, y: 675, width: 820, height: 38 },
              { text: "它见证了国内游戏行业从粗放增长到精细化生产的过程。", x: 111, y: 735, width: 910, height: 38 },
              { text: "很多学生和家长会问，这到底是不是一个好专业。", x: 111, y: 795, width: 780, height: 38 },
              { text: "答案往往取决于你期待它解决什么问题。", x: 111, y: 855, width: 660, height: 38 },
            ],
          }),
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "游戏艺术设计是个好专业吗？");
            assert.equal(viewerContext.ocrAnalysis.titleSource, "article_h1");
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/game-art-major-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/game-art-major-123");
      assert.equal(result.viewerTitleLineText, "游戏艺术设计是个好专业吗？");
      assert.equal(result.viewerTitleSource, "article_h1");
    } finally {
      Date.now = originalNow;
    }
  });

  it("accepts an external copied URL from a loaded viewer", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;

    try {
      const result = await extractShareCardUrl(
        { title: "BIG ANNOUNCEMENT from LinkedIn", clickX: 500, clickY: 400 },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "Sarah Lynne Bowman's Post", x: 111, y: 192, width: 640, height: 51 },
              { text: "LinkedIn 2026年6月14日 10:00", x: 111, y: 281.7, width: 360, height: 30 },
              { text: "BIG ANNOUNCEMENT", x: 111, y: 420, width: 500, height: 40 },
              { text: "I am excited to share a new update with everyone.", x: 111, y: 500, width: 820, height: 38 },
              { text: "Thank you to the entire team for making this possible.", x: 111, y: 560, width: 850, height: 38 },
              { text: "More details are available in the original post.", x: 111, y: 620, width: 760, height: 38 },
              { text: "Please follow the link for the full announcement.", x: 111, y: 680, width: 780, height: 38 },
            ],
          }),
          openViewerMenuFn: async () => ({
            copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          }),
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://www.linkedin.com/posts/sarah-bowman-big-announcement",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://www.linkedin.com/posts/sarah-bowman-big-announcement");
      assert.equal(result.copyUrlKind, "external_url");
      assert.equal(result.copiedUrlHost, "www.linkedin.com");
      assert.equal(result.copyFailureReason, null);
    } finally {
      Date.now = originalNow;
    }
  });

  it("skips OCR recovery verification when fast close returns to a known pre-view window", async () => {
    let verifyCalls = 0;
    let windowsCall = 0;

    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "File Transfer", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "File Transfer", x: 0, y: 0, width: 800, height: 600 },
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
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/fast-close-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => ({
          closed: true,
          currentWindows: [{ name: "File Transfer", x: 0, y: 0, width: 800, height: 600 }],
          frontWindow: { name: "File Transfer", x: 0, y: 0, width: 800, height: 600 },
          usedCommandW: false,
        }),
        verifyChatRecoveredFn: async () => {
          verifyCalls += 1;
          return true;
        },
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/fast-close-123");
    assert.equal(verifyCalls, 0);
  });

  it("falls back to OCR recovery verification when the fast close state is uncertain", async () => {
    let verifyCalls = 0;
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
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/verify-close-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => ({
          closed: true,
          currentWindows: [{ name: "unknown", x: 0, y: 0, width: 800, height: 600 }],
          frontWindow: { name: "unknown", x: 0, y: 0, width: 800, height: 600 },
          usedCommandW: false,
        }),
        verifyChatRecoveredFn: async () => {
          verifyCalls += 1;
          return true;
        },
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/verify-close-123");
    assert.equal(verifyCalls, 1);
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

  it("ignores bilibili text outside the viewer when deciding viewer skip reason", async () => {
    let windowsCall = 0;
    let menuOpened = false;
    const result = await extractShareCardUrl(
      {
        title: "黄仁勋：奔跑吧，为了食物，或者“不成为食物”",
        rawText: "黄仁勋：奔跑吧，为了食物，或者“不成为食物” AI 时代的起跑线确实被拉平了 罗辑思维",
        clickX: 500,
        clickY: 400,
      },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "File Transfer", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "File Transfer", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 40, y: 20, width: 980, height: 760 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 40, y: 20, width: 980, height: 760 }),
        captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 2880, height: 1800 }),
        recognizeTextFromImageFn: async () => ({
          width: 2880,
          height: 1800,
          lines: [
            { text: "黄仁勋：奔跑吧，为了食物，", x: 100, y: 120, width: 520, height: 40 },
            { text: "或者“不成为食物”", x: 100, y: 170, width: 420, height: 40 },
            { text: "原创 罗辑思维 2026年5月17日", x: 100, y: 230, width: 520, height: 30 },
            { text: "AI 时代的起跑线确实被拉平了，但新的竞争维度也同时出现了。", x: 100, y: 320, width: 780, height: 34 },
            { text: "这是一篇正常的公众号文章内容。", x: 100, y: 380, width: 520, height: 34 },
            { text: "- https://www.bilibili.com/video/BV1YR5E6EE90", x: 1900, y: 700, width: 720, height: 30 },
            { text: "> bilibili_video", x: 1940, y: 760, width: 260, height: 30 },
          ],
        }),
        openViewerMenuFn: async () => {
          menuOpened = true;
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/normal-viewer-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(menuOpened, true);
    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/normal-viewer-123");
  });

  it("matches text-share viewers by body opener instead of the card header", async () => {
    let windowsCall = 0;
    let menuOpened = false;

    const result = await extractShareCardUrl(
      {
        title: "花叔的文字分享",
        rawText: "花叔的文字分享\n花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。\n花叔",
        cardType: "text_share_card",
        clickX: 500,
        clickY: 400,
      },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "File Transfer", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "File Transfer", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 0, y: 0, width: 1470, height: 1846 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 0, width: 1470, height: 1846 }),
        captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 1846 }),
        recognizeTextFromImageFn: async () => ({
          width: 1470,
          height: 1846,
          lines: [
            { text: "花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。", x: 58, y: 155, width: 1180, height: 42 },
            { text: "这位去年刚从Anthropic跳到Google DeepMind的哥们，参与过Claude 3.7/4.5和Gemini 3。", x: 58, y: 214, width: 1230, height: 40 },
            { text: "他说几条我觉得最有意思的：", x: 58, y: 274, width: 500, height: 38 },
            { text: "1. Google禁止员工用Claude Code，但姚顺宇保守估计自己90%代码是AI生成的。", x: 58, y: 376, width: 1220, height: 40 },
            { text: "2. 他离开Anthropic的原因里，反对Dario反华占40%。", x: 58, y: 596, width: 900, height: 40 },
            { text: "3. Claude 3.5/3.6/3.7的命名是个草台班子般的乌龙。", x: 58, y: 704, width: 940, height: 40 },
            { text: "4. Claude Code是「个人英雄主义的开端」。", x: 58, y: 870, width: 780, height: 40 },
            { text: "花叔", x: 136, y: 1770, width: 90, height: 32 },
          ],
        }),
        openViewerMenuFn: async (viewerContext) => {
          menuOpened = true;
          assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "花了大半天把张小珺访谈姚顺宇的4小时长访听了一遍。");
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/text-share-copy-link-1",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(menuOpened, true);
    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/text-share-copy-link-1");
  });

  it("does not convert an untrusted viewer context into a bilibili skipped card", async () => {
    let windowsCall = 0;
    let menuOpened = false;
    const result = await extractShareCardUrl(
      { title: "正常公众号文章标题", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: () => {},
        getWeChatWindowsFn: () => {
          windowsCall += 1;
          if (windowsCall === 1) return [{ name: "File Transfer", x: 0, y: 0, width: 800, height: 600 }];
          return [
            { name: "File Transfer", x: 0, y: 0, width: 800, height: 600 },
            { name: "viewer", x: 40, y: 20, width: 980, height: 760 },
          ];
        },
        getFrontWeChatWindowFn: () => ({ name: "viewer", x: 40, y: 20, width: 980, height: 760 }),
        captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 2880, height: 1800 }),
        recognizeTextFromImageFn: async () => ({
          width: 2880,
          height: 1800,
          lines: [
            { text: "File Transfer", x: 200, y: 120, width: 200, height: 30 },
            { text: "- https://www.bilibili.com/video/BV1YR5E6EE90", x: 1900, y: 700, width: 720, height: 30 },
            { text: "> bilibili_video", x: 1940, y: 760, width: 260, height: 30 },
          ],
        }),
        openViewerMenuFn: async () => {
          menuOpened = true;
          return {
            copyLine: null,
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(menuOpened, false);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "viewer_context_mismatch");
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

  it("reopens the viewer menu before browser fallback after copy-link fails", async () => {
    let windowsCall = 0;
    let menuCalls = 0;
    const clicks = [];
    const result = await extractShareCardUrl(
      { title: "第一篇文章", clickX: 500, clickY: 400 },
      {},
      {
        clearClipboardTextFn: () => {},
        clickAtPointFn: (x, y) => {
          clicks.push({ x, y });
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
        recognizeTextFromImageFn: async () => ({ width: 2880, height: 1800, lines: [] }),
        openViewerMenuFn: async () => {
          menuCalls += 1;
          if (menuCalls === 1) {
            return {
              copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
              browserLine: { text: "使用默认浏览器打开", x: 20, y: 100, width: 180, height: 20 },
              ocrResult: { width: 1000, height: 1000, lines: [] },
              screenBounds: { x: 0, y: 0, width: 1000, height: 1000 },
            };
          }
          return {
            copyLine: null,
            browserLine: { text: "使用默认浏览器打开", x: 500, y: 600, width: 180, height: 20 },
            ocrResult: { width: 1000, height: 1000, lines: [] },
            screenBounds: { x: 0, y: 0, width: 1000, height: 1000 },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => "https://mp.weixin.qq.com/s/reopened-browser-123",
        readClipboardTextFn: () => "",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.usedBrowserFallback, true);
    assert.equal(result.url, "https://mp.weixin.qq.com/s/reopened-browser-123");
    assert.equal(menuCalls, 2);
    assert.deepEqual(clicks.at(-1), { x: 590, y: 610 });
    assert.equal(result.copyFailureReason, "clipboard_timeout");
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

  it("waits for article content after the title appears before opening the menu", async () => {
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
          if (ocrCall < 3) {
            return {
              width: 2880,
              height: 1800,
              lines: [
                { text: "第一篇文章非常长的标题", x: 120, y: 80, width: 720, height: 42 },
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
              { text: "真正卡住大多数人的，是自己没有一个标准的工作流程。", x: 120, y: 360, width: 760, height: 36 },
              { text: "特别在创造一个你想要的软件或者程序的时候。", x: 120, y: 420, width: 680, height: 36 },
            ],
          };
        },
        openViewerMenuFn: async (viewerContext) => {
          assert.equal(viewerContext.ocrAnalysis.matched, true);
          assert.equal(viewerContext.ocrAnalysis.contentLines >= 4, true);
          return {
            copyLine: { text: "复制链接", x: 20, y: 80, width: 100, height: 20 },
            browserLine: null,
            ocrResult: { lines: [] },
          };
        },
        readFrontBrowserUrlFromAddressBarFn: () => null,
        readClipboardTextFn: () => "https://mp.weixin.qq.com/s/title-before-content-123",
        sleepMsFn: () => {},
        closeViewerWindowFn: () => true,
        verifyChatRecoveredFn: async () => true,
      }
    );

    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://mp.weixin.qq.com/s/title-before-content-123");
  });

  it("opens the menu when title and article metadata are visible despite persistent loading text", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;
    const loadedShellOcr = {
      width: 1470,
      height: 956,
      lines: [
        { text: "Loading.....", x: 200, y: 47, width: 68, height: 13 },
        { text: "55万奖金！全国首个OPC能力挑战赛来了！", x: 28, y: 98, width: 427, height: 24 },
        { text: "原创", x: 20, y: 140, width: 40, height: 15 },
        { text: "Datawhale Datawhale", x: 96, y: 140, width: 150, height: 15 },
        { text: "2026年5月22日 22:20", x: 239, y: 141, width: 169, height: 15 },
        { text: "Datawhale", x: 45, y: 604, width: 70, height: 16 },
        { text: "+关注", x: 104, y: 604, width: 31, height: 18 },
        { text: "199", x: 329, y: 607, width: 27, height: 14 },
        { text: "1293", x: 382, y: 607, width: 35, height: 14 },
      ],
    };

    try {
      const result = await extractShareCardUrl(
        { title: "55万奖金！全国首个OPC能力挑战赛来了！", clickX: 500, clickY: 400 },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: captureMainScreenStub,
          recognizeTextFromImageFn: async () => loadedShellOcr,
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "55万奖金！全国首个OPC能力挑战赛来了！");
            assert.equal(viewerContext.ocrAnalysis.contentLines, 0);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/persistent-loading-shell-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/persistent-loading-shell-123");
      assert.equal(result.viewerReadyAttempts, 0);
      assert.equal(result.timings.viewer_ready_wait_ms < 1000, true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("matches a loaded viewer from OCR fallback title fragments when the candidate title is incomplete", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;
    const loadedViewerOcr = {
      width: 1470,
      height: 956,
      lines: [
        { text: "Loading.....", x: 200, y: 47, width: 68, height: 13 },
        { text: "公司可能是一个300年的临时实验", x: 28, y: 98, width: 350, height: 24 },
        { text: "原创", x: 28, y: 140, width: 40, height: 15 },
        { text: "花叔", x: 68, y: 140, width: 40, height: 15 },
        { text: "2026年5月23日", x: 146, y: 140, width: 120, height: 15 },
        { text: "09:02", x: 260, y: 140, width: 45, height: 15 },
      ],
    };

    try {
      const result = await extractShareCardUrl(
        {
          title: "你睁开眼，习惯了上班 公司可能是",
          rawText: "你睁开眼，习惯了上班\n公司可能是\n=在公司里，习惯了创\n临时实验\n业=注册一家公司，…\n花叔",
          cardType: "single_article_card",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: captureMainScreenStub,
          recognizeTextFromImageFn: async () => loadedViewerOcr,
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "公司可能是一个300年的临时实验");
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/title-fragment-match-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/title-fragment-match-123");
    } finally {
      Date.now = originalNow;
    }
  });

  it("opens the menu for a loaded article shell even when the candidate title does not match the viewer title", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;
    const loadedViewerOcr = {
      width: 1470,
      height: 956,
      lines: [
        { text: "Loading.....", x: 200, y: 47, width: 68, height: 13 },
        { text: "帮大家总结了一下凌晨的Google 1/O", x: 28, y: 98, width: 370, height: 24 },
        { text: "2026开发者大会。", x: 28, y: 130, width: 220, height: 24 },
        { text: "原创 数字生命卡兹克", x: 28, y: 176, width: 170, height: 15 },
        { text: "2026年5月20日", x: 205, y: 176, width: 120, height: 15 },
        { text: "06:36", x: 330, y: 176, width: 45, height: 15 },
      ],
    };

    try {
      const result = await extractShareCardUrl(
        {
          title: "Google 1/O 2026开发者大⋯ 量大管饱的一夜",
          rawText: "Google 1/O 2026开发者大⋯\n量大管饱的一夜",
          cardType: "single_article_card",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: captureMainScreenStub,
          recognizeTextFromImageFn: async () => loadedViewerOcr,
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleMatched, false);
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/google-loaded-shell-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/google-loaded-shell-123");
      assert.equal(result.viewerArticleShellLoaded, true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("uses the article H1 instead of the chrome title when deciding viewer readiness", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        {
          title: "的劳动：哈伦•法罗基的生活手册 imailation and the Li",
          rawText: "的劳动：哈伦•法罗基的生活手册\nimailation and the Li",
          cardType: "single_article_card",
          clickX: 535,
          clickY: 200,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "Thomas Elsaesser 模拟与不i", x: 410, y: 94, width: 316, height: 26 },
              {
                text: "Thomas Elsaesser 模拟与不可见性的劳动：哈伦•法罗基的生活手",
                x: 51,
                y: 196,
                width: 1342,
                height: 47,
              },
              { text: "indienova", x: 162, y: 346, width: 154, height: 26 },
              {
                text: "为什么当代最重要的影像作者之一的法罗基，在他去世前最后留下的影像却是一部对电",
                x: 73,
                y: 1319,
                width: 1295,
                height: 38,
              },
              {
                text: "作为法罗基相关论文集《Harun Farocki: Working on the Sight-Lines》的编者以及电影",
                x: 73,
                y: 1460,
                width: 1316,
                height: 43,
              },
              {
                text: "研究的重要人物，Thomas EIsaesser 的这篇文章意图似乎在于法罗基生前留下的最后",
                x: 73,
                y: 1515,
                width: 1303,
                height: 39,
              },
              {
                text: "他尝试将《平行》与法罗基过往的作品全体建立连接，而不仅停留在",
                x: 73,
                y: 1711,
                width: 1100,
                height: 43,
              },
            ],
          }),
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(
              viewerContext.ocrAnalysis.titleLine?.text,
              "Thomas Elsaesser 模拟与不可见性的劳动：哈伦•法罗基的生活手"
            );
            assert.equal(viewerContext.ocrAnalysis.titleSource, "article_h1");
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/thomas-h1-ready-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/thomas-h1-ready-123");
      assert.equal(result.viewerTitleSource, "article_h1");
      assert.equal(
        result.viewerH1LineText,
        "Thomas Elsaesser 模拟与不可见性的劳动：哈伦•法罗基的生活手"
      );
      assert.equal(result.viewerChromeTitleLineText, "Thomas Elsaesser 模拟与不i");
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not treat adjacent Retina screenshot text as the viewer title", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        {
          title: "与玩家互动：用戏剧技巧提升 社媒运营能力",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "Loading.....", x: 401.7, y: 93.9, width: 136.7, height: 25.6 },
              { text: "FeishuToPKM", x: 1482.8, y: 358.5, width: 132.5, height: 21.5 },
              { text: "--since 2026-05-24T00:00:00", x: 1530, y: 450, width: 420, height: 24 },
            ],
          }),
          openViewerMenuFn: async () => {
            openedMenu = true;
            return { copyLine: null, browserLine: null, ocrResult: { lines: [] } };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, false);
      assert.equal(result.status, "failed");
      assert.equal(result.reason, "viewer_not_ready");
      assert.equal(result.viewerTitleLineText, null);
      assert.equal(result.viewerArticleShellLoaded, false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("uses the viewer window screen instead of cross-screen desktop bounds for viewer OCR", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;
    const screenshotPreferredRects = [];

    try {
      const result = await extractShareCardUrl(
        {
          title: "Stefano Gualeni 什么是一个哲学游戏",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: (_path, preferredRect) => {
            screenshotPreferredRects.push(preferredRect ?? null);
            return preferredRect
              ? { x: 0, y: 0, width: 1470, height: 956 }
              : { x: -1080, y: 0, width: 2550, height: 956 };
          },
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "Stefano Gualeni 什么是一个哲学游戏", x: 410, y: 196, width: 520, height: 48 },
              { text: "原创", x: 60, y: 282, width: 56, height: 30 },
              { text: "indienova", x: 140, y: 282, width: 130, height: 30 },
              { text: "2026年5月31日 09:15", x: 300, y: 282, width: 260, height: 30 },
              { text: "•.ilehelper-macos-ingest", x: 1576, y: 265, width: 342, height: 26 },
              { text: "FeishuToPKM", x: 1483, y: 359, width: 132, height: 22 },
            ],
          }),
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "Stefano Gualeni 什么是一个哲学游戏");
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/stefano-multiscreen-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/stefano-multiscreen-123");
      assert.equal(result.viewerTitleLineText, "Stefano Gualeni 什么是一个哲学游戏");
      assert.equal(screenshotPreferredRects.some((rect) => rect?.name === "viewer"), true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("normalizes mismatched cross-screen bounds before filtering viewer OCR", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        {
          title: "这可能是最好用的游戏设计开源 Skill库",
          clickX: 500,
          clickY: 400,
        },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: -1080, y: 0, width: 2550, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "这可能是最好用的游戏设计开源 Skill库", x: 410, y: 196, width: 620, height: 48 },
              { text: "原创", x: 60, y: 282, width: 56, height: 30 },
              { text: "游戏研究社", x: 140, y: 282, width: 130, height: 30 },
              { text: "2026年5月31日 09:15", x: 300, y: 282, width: 260, height: 30 },
              { text: "•.ilehelper-macos-ingest", x: 1576, y: 265, width: 342, height: 26 },
            ],
          }),
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.titleLine?.text, "这可能是最好用的游戏设计开源 Skill库");
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/normalized-multiscreen-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.viewerTitleLineText, "这可能是最好用的游戏设计开源 Skill库");
    } finally {
      Date.now = originalNow;
    }
  });

  it("waits for a slow-loading viewer to show the article shell before opening the menu", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        { title: "与玩家互动：用戏剧技巧提升 社媒运营能力", clickX: 500, clickY: 400 },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => {
            if (now < 6000) {
              return {
                width: 2940,
                height: 1912,
                lines: [
                  { text: "Loading.....", x: 401.7, y: 93.9, width: 136.7, height: 25.6 },
                ],
              };
            }
            return {
              width: 2940,
              height: 1912,
              lines: [
                { text: "Loading.....", x: 401.7, y: 93.9, width: 136.7, height: 25.6 },
                { text: "与玩家互动：用戏剧技巧提升社媒运营能力", x: 55.6, y: 196, width: 820, height: 48 },
                { text: "原创", x: 59.8, y: 281.7, width: 55.6, height: 30.3 },
                { text: "游戏葡萄", x: 140, y: 281.7, width: 120, height: 30.3 },
                { text: "2026年5月24日 16:32", x: 280, y: 281.7, width: 260, height: 30.3 },
              ],
            };
          },
          openViewerMenuFn: async (viewerContext) => {
            openedMenu = true;
            assert.equal(viewerContext.ocrAnalysis.articleShellLoaded, true);
            assert.equal(now >= 6000, true);
            return {
              copyLine: { text: "Copy Link", x: 20, y: 80, width: 100, height: 20 },
              browserLine: null,
              ocrResult: { lines: [] },
            };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "https://mp.weixin.qq.com/s/slow-ready-viewer-123",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, true);
      assert.equal(result.status, "ok");
      assert.equal(result.url, "https://mp.weixin.qq.com/s/slow-ready-viewer-123");
      assert.equal(result.viewerReadyAttempts > 100, true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("waits the full slow-load timeout before failing a permanently loading viewer", async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;

    let windowsCall = 0;
    let openedMenu = false;

    try {
      const result = await extractShareCardUrl(
        { title: "Agentland Fortnight | Agent 游戏开发工作坊Vol.6 开始.", clickX: 500, clickY: 400 },
        {},
        {
          clearClipboardTextFn: () => {},
          clickAtPointFn: () => {},
          getWeChatWindowsFn: () => {
            windowsCall += 1;
            if (windowsCall === 1) return [{ name: "main", x: 0, y: 0, width: 735, height: 923 }];
            return [
              { name: "main", x: 0, y: 0, width: 735, height: 923 },
              { name: "viewer", x: 0, y: 33, width: 735, height: 923 },
            ];
          },
          getFrontWeChatWindowFn: () => ({ name: "viewer", x: 0, y: 33, width: 735, height: 923 }),
          captureFullScreenScreenshotFn: () => ({ x: 0, y: 0, width: 1470, height: 956 }),
          recognizeTextFromImageFn: async () => ({
            width: 2940,
            height: 1912,
            lines: [
              { text: "Loading.....", x: 401.7, y: 93.9, width: 136.7, height: 25.6 },
            ],
          }),
          openViewerMenuFn: async () => {
            openedMenu = true;
            return { copyLine: null, browserLine: null, ocrResult: { lines: [] } };
          },
          readFrontBrowserUrlFromAddressBarFn: () => null,
          readClipboardTextFn: () => "",
          sleepMsFn: (ms) => {
            now += ms;
          },
          closeViewerWindowFn: () => true,
          verifyChatRecoveredFn: async () => true,
        }
      );

      assert.equal(openedMenu, false);
      assert.equal(result.status, "failed");
      assert.equal(result.reason, "viewer_not_ready");
      assert.equal(result.timings.viewer_ready_wait_ms >= 8000, true);
      assert.equal(result.viewerReadyAttempts >= 190, true);
    } finally {
      Date.now = originalNow;
    }
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
