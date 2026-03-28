import path from "node:path";
import { chromium } from "playwright";

const WECHAT_WEB_URL = "https://wx.qq.com/";
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for QR scan
const PAGE_LOAD_TIMEOUT_MS = 30_000;

/**
 * Launch a persistent Chromium browser context using the given profile directory.
 * Returns { context, page, close }.
 */
export async function launchBrowser(profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    locale: "zh-CN",
    args: ["--start-maximized"],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    async close() {
      await context.close().catch(() => {});
    },
  };
}

/**
 * Navigate to wx.qq.com and ensure the user is logged in.
 * If a QR code is visible, prints instructions and waits up to LOGIN_TIMEOUT_MS.
 * Throws if login is not completed in time or if the account does not support WeChat Web.
 */
export async function ensureLoggedIn(page) {
  await page.goto(WECHAT_WEB_URL, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });

  // Check for the "account not supported for web" error message
  const unsupportedText = await page
    .locator("text=/无法登录微信网页版|不支持登录网页版/i")
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (unsupportedText) {
    throw new Error(
      "此微信账号不支持网页版（wx.qq.com 显示无法登录）。\n" +
        "请参考 SKILL.md 中的"账号不支持网页版"说明，或联系技术支持切换到桌面版方案。"
    );
  }

  const qrVisible = await isQrCodeVisible(page);
  if (qrVisible) {
    console.log("=".repeat(60));
    console.log("请在浏览器窗口中扫描微信二维码以登录 WeChat Web。");
    console.log(`等待时间：最长 ${LOGIN_TIMEOUT_MS / 1000} 秒`);
    console.log("=".repeat(60));
    await waitForLogin(page, LOGIN_TIMEOUT_MS);
    console.log("登录成功！");
  }

  // Final check: verify we're on the main chat page
  await page
    .locator("#navBar, .chat_list, .contact_list, [id='app']")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Return true if the WeChat Web QR code login screen is visible.
 */
export async function isQrCodeVisible(page) {
  // The QR code image or its container appears before login
  return page
    .locator("#header .qrcode, .qrcode img, .login_qrcode_img, img[src*='qrcode']")
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
}

/**
 * Wait for the user to complete QR code login.
 * Resolves when the main chat interface appears.
 */
export async function waitForLogin(page, timeoutMs) {
  // Poll: wait until the QR code disappears and chat UI appears
  await page
    .locator("#navBar, .chat_list, [id='chatArea'], .slide-left-leave, .newLoginPage")
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}
