import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { activateWeChat, getWeChatChatWindow, getFrontWeChatWindow, clickAtPoint, clearClipboardText,
  sendKeystroke, scrollAtPoint, sleepMs, captureWindowScreenshot } from "./applescript.js";
import { readVisibleClipboardSnapshot } from "./chat.js";
import { recognizeTextFromImage } from "./ocr.js";
import { detectArticleTabClose } from "./tab-controls.js";
import { probeUiEnvironment, captureVisibleUiPage, extractShareCardUrl, extractImageContent, findViewerTitleLine } from "./ui.js";

export async function loadDockedLayout(skillRoot, fsImpl = fs) {
  let text;
  try { text = await fsImpl.readFile(path.join(skillRoot, "local/ui-layout.json"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const layout = JSON.parse(text);
  if (layout.mode !== "docked_articles" ||
      ![layout.windowWidth, layout.windowHeight, layout.chatWidth].every(n => Number.isFinite(n) && n > 0) ||
      layout.chatWidth >= layout.windowWidth) {
    throw new Error("Invalid local/ui-layout.json: expected calibrated docked article bounds.");
  }
  return layout;
}

export function findVisibleTabClosePoint(lines, image, window) {
  const line = lines.find(item => /^[×xX]$/.test(item.text.trim()) || /[.…⋯]\s*[×xX]$/.test(item.text.trim()));
  if (!line) return null;
  const standalone = /^[×xX]$/.test(line.text.trim());
  return {
    x: window.x + (standalone ? line.x + line.width / 2 : line.x + line.width - line.height * 0.35) * window.width / image.width,
    y: window.y + (line.y + line.height / 2) * window.height / image.height,
  };
}

// A host-local calibration keeps the chat and article surfaces separate. Never
// guess a new split after a resize: the user prepares the first article once.
export function createDockedArticleSession(layout, deps = {}) {
  const getWindow = deps.getWindow ?? getWeChatChatWindow;
  const getFrontWindow = deps.getFrontWindow ?? getFrontWeChatWindow;
  const activate = deps.activate ?? activateWeChat;
  const click = deps.click ?? clickAtPoint;
  const key = deps.key ?? sendKeystroke;
  const sleep = deps.sleep ?? sleepMs;
  const capture = deps.capture ?? ((bounds, file, options = {}) =>
    captureWindowScreenshot(bounds, file, { preserveViewer: true, ...options }));
  const ocr = deps.ocr ?? recognizeTextFromImage;
  const extract = deps.extract ?? extractShareCardUrl;
  let attempts = 0;
  let origin = null;
  let openedArticleKey = null;
  const candidateKey = candidate => JSON.stringify([candidate.title, candidate.clickX, candidate.clickY]);
  const current = () => {
    const window = getWindow();
    if (!window || Math.abs(window.width - layout.windowWidth) > 2 || Math.abs(window.height - layout.windowHeight) > 2 ||
        (origin && (Math.abs(window.x - origin.x) > 2 || Math.abs(window.y - origin.y) > 2))) {
      throw new Error("docked_layout_changed: 请先打开第一篇文章，并保持校准时的窗口大小。");
    }
    origin ??= { x: window.x, y: window.y };
    return window;
  };
  const chat = () => ({ ...current(), width: layout.chatWidth });
  const focusChat = () => {
    const window = chat();
    activate();
    click(window.x + window.width * 0.45, window.y + window.height * 0.4);
  };
  const readSnapshot = debug => readVisibleClipboardSnapshot(debug, {
    copyVisibleMessagesFn: () => {
      focusChat();
      clearClipboardText();
      key("a", ["command down"]); sleep(130);
      key("c", ["command down"]); sleep(180);
    },
  });
  const tabLines = result => {
    const scaleX = result.width / layout.windowWidth;
    const scaleY = result.height / layout.windowHeight;
    return result.lines.filter(line => line.text?.trim() &&
      line.x > layout.chatWidth * scaleX &&
      line.y >= 0 && line.y + line.height < 50 * scaleY);
  };
  return {
    async probe(options) {
      const screenshot = path.join(os.tmpdir(), `wechat-docked-preflight-${process.pid}-${Date.now()}.png`);
      try {
        capture(current(), screenshot);
        const result = await ocr(screenshot);
        if (!tabLines(result).some(line => /[\p{L}\p{N}]/u.test(line.text))) {
          return { ui_probe_status: "docked_article_not_open", reasons: ["请先打开第一篇文章，保持聊天与阅读栏并排。"] };
        }
      } finally {
        await fs.rm(screenshot, { force: true });
      }
      return probeUiEnvironment(options, {
        getFrontWeChatWindowFn: chat, readVisibleClipboardSnapshotFn: readSnapshot,
      });
    },
    scanOptions: {
      readVisibleClipboardSnapshotFn: readSnapshot,
      probeUiEnvironmentFn: options => probeUiEnvironment(options, {
        getFrontWeChatWindowFn: chat, readVisibleClipboardSnapshotFn: readSnapshot,
      }),
      captureVisibleUiPageFn: options => {
        current();
        return captureVisibleUiPage(options, { getFrontWeChatWindowFn: chat });
      },
      scrollPageFn: () => {
        const window = chat();
        focusChat();
        (deps.scroll ?? scrollAtPoint)(window.x + window.width * 0.45, window.y + window.height * 0.4, { lineDelta: 4, repeat: 3 });
        sleep(160);
      },
      extractImageContentFn: (candidate, options, extractionDeps) =>
        (deps.extractImage ?? extractImageContent)(candidate, options, {
          ...extractionDeps,
          captureRectScreenshotFn: (bounds, screenshot) => capture(bounds, screenshot, { preserveViewer: true }),
          detectEmbeddedArticleFn: async item => {
            const window = current();
            const screenshot = path.join(os.tmpdir(), `wechat-docked-type-${process.pid}-${Date.now()}.png`);
            try {
              for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt) sleep(400);
                capture(window, screenshot);
                const result = await ocr(screenshot);
                const articleOcr = { ...result, lines: result.lines.filter(line =>
                  line.x >= layout.chatWidth * result.width / window.width) };
                if (findViewerTitleLine(articleOcr, item)) {
                  openedArticleKey = candidateKey(item);
                  return true;
                }
              }
              return false;
            } finally {
              await fs.rm(screenshot, { force: true });
            }
          },
        }),
      extractShareCardUrlFn: async (candidate, options, extractionDeps) => {
        const window = current();
        attempts += 1;
        const reuseOpenViewer = openedArticleKey === candidateKey(candidate);
        openedArticleKey = null;
        const result = await extract(candidate, {
          ...options, keepViewerOpen: true, reuseOpenViewer,
          preparedViewerContext: {
            mode: "docked_article", window, screenRect: window, screenBounds: window,
          },
        }, {
          ...extractionDeps,
          captureFullScreenScreenshotFn: (screenshot, target = null) => {
            const front = target ?? getFrontWindow() ?? current();
            const isChat = /^(weixin|wechat|微信)$/i.test(String(front.name ?? ""));
            const bounds = isChat
              ? { ...current(), x: front.x + layout.chatWidth, width: front.width - layout.chatWidth }
              : front;
            capture(bounds, screenshot, { preserveViewer: true });
            return bounds;
          },
          captureVideoShareScreenshotFn: (bounds, screenshot) => capture(bounds, screenshot, { preserveViewer: true }),
        });
        focusChat();
        return result;
      },
    },
    async finish() {
      if (!attempts) return { status: "not_needed" };
      const screenshot = path.join(os.tmpdir(), `wechat-docked-cleanup-${process.pid}-${Date.now()}.png`);
      let previous = null;
      let closed = 0;
      let verifiedClosed = false;
      try {
        for (let i = 0; i <= Math.min(100, attempts + 32); i++) {
          let window = getWindow();
          for (let retry = 0; !window && retry < 5; retry++) {
            sleep(200);
            window = getWindow();
          }
          if (!window) return { status: "failed", reason: "chat_window_missing", closed };
          if (Math.abs(window.width - layout.chatWidth) <= 2) { verifiedClosed = true; return { status: "closed", closed }; }
          current();
          capture(window, screenshot);
          const result = await ocr(screenshot);
          const tabs = tabLines(result);
          // An empty/hidden screenshot is not evidence that tabs are closed.
          if (!result.lines?.some(line => /^(File Transfer(?: Assistant)?|文件传输助手)$/i.test(line.text.trim()) &&
              line.y < 60 * result.height / layout.windowHeight &&
              line.x < layout.chatWidth * result.width / layout.windowWidth)) {
            return { status: "failed", reason: "cleanup_screenshot_unavailable", closed };
          }
          const control = await (deps.detectTabClose ?? detectArticleTabClose)(screenshot, layout);
          if (!tabs.length && !control) { verifiedClosed = true; return { status: "closed", closed }; }
          const signature = control?.fingerprint ?? JSON.stringify(tabs.map(line => [line.text, Math.round(line.x)]));
          if (signature === previous) return { status: "failed", reason: "article_tab_not_closed", closed };
          previous = signature;
          activate();
          // Cmd+W closes the host WeChat window on this build. Use the
          // calibrated close button belonging to the article tab instead.
          const closePoint = control
            ? { x: window.x + control.x * window.width / result.width,
                y: window.y + control.y * window.height / result.height }
            : findVisibleTabClosePoint(tabs, result, window);
          if (!closePoint) return { status: "failed", reason: "article_tab_close_not_visible", closed };
          click(closePoint.x, closePoint.y);
          sleep(250);
          closed += 1;
        }
        return { status: "failed", reason: "article_tabs_remaining", closed };
      } catch (error) {
        return { status: "failed", reason: error.message, closed };
      } finally {
        if (!verifiedClosed && deps.artifactDir) {
          await fs.mkdir(deps.artifactDir, { recursive: true });
          try { await fs.copyFile(screenshot, path.join(deps.artifactDir, "viewer-cleanup-failed.png")); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        await fs.rm(screenshot, { force: true });
      }
    },
  };
}
