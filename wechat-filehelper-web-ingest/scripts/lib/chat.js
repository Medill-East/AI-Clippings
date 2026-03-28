import { canonicalizeUrl, shouldSkipUrl, parseWeChatTimestamp, dedupeKey, newCaptureSessionId } from "./common.js";

const FILE_HELPER_NAMES = ["文件传输助手", "File Transfer", "filehelper"];

// ---------------------------------------------------------------------------
// Selectors — wx.qq.com DOM anchors
// (Update references/wechat-web-ui.md when these change after WeChat updates)
// ---------------------------------------------------------------------------
const SEL = {
  // Left panel: search box to locate a contact
  searchInput: "input.search_input, #search_bar input, .inputBox input[type='text']",
  // Contact items in the search result or contact list
  contactItem: ".contact_item, .chat_item",
  contactName: ".contact_item .nickname, .chat_item .nickname, .info .nickname",
  // Right panel: chat message scroll container
  chatPanel: "#chatArea .content, .chat_bd, #msgList",
  // Individual message wrapper
  msgWrap: ".msg",
  // Timestamp dividers within the chat
  timeDivider: ".msg .time_tag, .msg_createtime",
  // Plain text message content
  msgText: ".msg .content .plain, .msg .content .js_message_plain",
  // All <a> links inside a text message bubble
  msgTextLinks: ".msg .content .plain a[href], .msg .content .js_message_plain a[href]",
  // Share-card (article link preview) container
  shareCard: ".msg .content .app_msg_ext_info, .msg .content .msg_type_app, .msg .content .js_wx_tap_highlight",
  shareCardLink: "a[href]",
  shareCardTitle: ".title, .app_msg_ext_info .title",
  // Indicator that a card is a video channel (视频号)
  channelCardIndicator: ".channel_icon, .video_card, [class*='channel']",
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Open the File Transfer Assistant chat in the left panel.
 * Throws if the chat cannot be found.
 */
export async function openFileHelperChat(page) {
  // Try clicking directly in the chat list first (it's usually pinned at top)
  for (const name of FILE_HELPER_NAMES) {
    const item = page.locator(`${SEL.contactItem}:has-text("${name}")`).first();
    if (await item.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await item.click();
      await waitForChatPanel(page);
      return;
    }
  }

  // Fallback: use the search box
  const searchBox = page.locator(SEL.searchInput).first();
  await searchBox.waitFor({ state: "visible", timeout: 10_000 });
  await searchBox.click();
  await searchBox.fill("文件传输助手");
  await page.waitForTimeout(1_000); // let results render

  for (const name of FILE_HELPER_NAMES) {
    const result = page.locator(`${SEL.contactItem}:has-text("${name}")`).first();
    if (await result.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await result.click();
      await waitForChatPanel(page);
      return;
    }
  }

  throw new Error(
    "找不到「文件传输助手」聊天。\n请确保微信账号已使用过文件传输助手功能，或先在微信中向它发一条消息。"
  );
}

async function waitForChatPanel(page) {
  await page.locator(SEL.chatPanel).first().waitFor({ state: "visible", timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Scroll + collect
// ---------------------------------------------------------------------------

/**
 * Scroll up through the chat history, collecting all link records in [since, until].
 *
 * @param {import('playwright').Page} page
 * @param {Date} since
 * @param {Date} until
 * @param {number} maxScrolls
 * @param {boolean} debug  If true, logs extra info
 * @returns {object[]}  Array of link record objects (not yet merged into index)
 */
export async function scrollAndCollect(page, since, until, maxScrolls, debug = false) {
  const sessionId = newCaptureSessionId();
  const collected = [];
  const seenDedupeKeys = new Set();

  let scrolls = 0;
  let reachedSince = false;
  let prevScrollHeight = -1;

  const chatPanel = page.locator(SEL.chatPanel).first();

  // Start from the bottom (most recent)
  await chatPanel.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(800);

  while (scrolls < maxScrolls) {
    // Extract messages currently in DOM
    const snapshot = await extractMessagesFromDom(page, debug);

    if (debug) {
      console.log(`[scroll ${scrolls}] Found ${snapshot.length} message items in DOM`);
    }

    for (const item of snapshot) {
      if (!item.timestamp) continue;
      const msgTime = item.timestamp;

      if (msgTime > until) continue; // message is after our window, skip
      if (msgTime < since) {
        reachedSince = true;
        continue; // message is before our window
      }

      // Message is within [since, until]
      for (const link of item.links) {
        const canonical = canonicalizeUrl(link.url);
        if (shouldSkipUrl(canonical)) continue;
        const key = dedupeKey("文件传输助手", msgTime.toISOString(), canonical);
        if (seenDedupeKeys.has(key)) continue;
        seenDedupeKeys.add(key);
        collected.push({
          captured_at: new Date().toISOString(),
          message_time: msgTime.toISOString(),
          chat_name: "文件传输助手",
          message_type: link.type,
          title: link.title ?? "",
          url: canonical,
          dedupe_key: key,
          capture_session_id: sessionId,
        });
      }
    }

    if (reachedSince) break; // we've scrolled past the start of our window

    // Scroll up to load older messages
    const scrollHeight = await chatPanel.evaluate((el) => el.scrollHeight);
    if (scrolls > 0 && scrollHeight === prevScrollHeight) {
      if (debug) console.log("[scroll] No new content loaded, reached top of chat history");
      break;
    }
    prevScrollHeight = scrollHeight;

    await chatPanel.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(1_200); // wait for lazy-loaded messages
    scrolls++;
  }

  if (debug) {
    console.log(`[collect] Total unique links collected: ${collected.length}`);
  }

  return collected;
}

// ---------------------------------------------------------------------------
// DOM extraction
// ---------------------------------------------------------------------------

/**
 * Extract all message items currently visible in the chat DOM.
 * Returns an array of { timestamp: Date|null, links: [{url, type, title}] }.
 *
 * This runs inside Node.js (not page.evaluate) so we can reuse JS utilities.
 * We use Playwright's locator API to walk elements.
 */
export async function extractMessagesFromDom(page, debug = false) {
  // Collect all raw data from the page via a single page.evaluate call
  const rawMessages = await page.evaluate((sel) => {
    const results = [];

    // Collect all timestamp dividers and their positions
    const timeDividers = [...document.querySelectorAll(sel.timeDivider)];
    const timeMap = timeDividers.map((el) => ({
      text: el.textContent?.trim() ?? "",
      top: el.getBoundingClientRect().top,
    }));

    // Get all message wrappers
    const msgs = [...document.querySelectorAll(sel.msgWrap)];

    for (const msg of msgs) {
      const msgTop = msg.getBoundingClientRect().top;

      // Find the closest timestamp above this message
      let closestTime = null;
      let closestDist = Infinity;
      for (const td of timeMap) {
        const dist = msgTop - td.top;
        if (dist >= 0 && dist < closestDist) {
          closestDist = dist;
          closestTime = td.text;
        }
      }

      // Look for inline timestamp within this message
      const inlineTime = msg.querySelector(sel.timeDivider);
      if (inlineTime) {
        closestTime = inlineTime.textContent?.trim() ?? closestTime;
      }

      const links = [];

      // 1. Text URLs: all <a> links in plaintext bubbles
      const textLinks = msg.querySelectorAll(sel.msgTextLinks);
      for (const a of textLinks) {
        const href = a.getAttribute("href");
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          links.push({ url: href, type: "text_url", title: a.textContent?.trim() ?? "" });
        }
      }

      // 2. Share cards: article link preview cards
      const cards = msg.querySelectorAll(sel.shareCard);
      for (const card of cards) {
        // Skip if it looks like a video channel card
        if (card.querySelector(sel.channelCardIndicator)) continue;
        if (card.classList.toString().includes("channel")) continue;

        const anchor = card.querySelector(sel.shareCardLink);
        if (!anchor) continue;
        const href = anchor.getAttribute("href");
        if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) continue;

        const titleEl = card.querySelector(sel.shareCardTitle);
        const title = titleEl?.textContent?.trim() ?? anchor.textContent?.trim() ?? "";

        links.push({ url: href, type: "share_card", title });
      }

      if (links.length > 0 || closestTime) {
        results.push({ timestampText: closestTime, links });
      }
    }

    return results;
  }, SEL);

  // Parse timestamps in Node.js (can't import ESM in page.evaluate)
  const now = new Date();
  return rawMessages.map((item) => ({
    timestamp: item.timestampText ? parseWeChatTimestamp(item.timestampText, now) : null,
    links: item.links,
  }));
}
