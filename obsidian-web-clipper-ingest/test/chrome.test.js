import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getExtensionWorker,
  launchChromeContext,
  selectTabIdForUrl,
} from "../scripts/lib/chrome.js";

const systemChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function findChromeForTestingPath() {
  const configuredPath = process.env.OBSIDIAN_CLIPPER_TEST_CHROME_PATH;
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const cachedPaths = existsSync(cacheRoot)
    ? readdirSync(cacheRoot)
        .filter((entry) => /^chromium-\d+$/.test(entry))
        .sort()
        .reverse()
        .map((entry) =>
          path.join(
            cacheRoot,
            entry,
            "chrome-mac-arm64",
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
        )
    : [];

  return [configuredPath, ...cachedPaths].find((candidate) => candidate && existsSync(candidate)) ?? null;
}

const chromeForTestingPath = findChromeForTestingPath();
const configPath = path.join(
  os.homedir(),
  "Documents",
  "AI",
  "Codex",
  "Clippings",
  "obsidian-web-clipper-ingest",
  "local",
  "config.json",
);
const integrationConfig = existsSync(configPath)
  ? JSON.parse(await fs.readFile(configPath, "utf8"))
  : null;
const integrationReady = Boolean(
  process.platform === "darwin" &&
    chromeForTestingPath &&
    integrationConfig?.userDataDir &&
    existsSync(integrationConfig.userDataDir) &&
    existsSync(
      path.join(
        integrationConfig.userDataDir,
        integrationConfig.profileDirectory,
        "Extensions",
        integrationConfig.extensionId,
      ),
    ),
);

test("selectTabIdForUrl binds a page URL to its own tab", () => {
  const tabs = [
    { id: 101, url: "https://example.com/first", active: false },
    { id: 102, url: "https://example.com/second", active: true },
  ];

  assert.equal(selectTabIdForUrl(tabs, "https://example.com/first"), 101);
  assert.equal(selectTabIdForUrl(tabs, "https://example.com/missing"), null);
});

test("launchChromeContext launches the configured Chrome executable", {
  skip: process.platform !== "darwin",
}, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-chrome-"));
  const sourceUserDataDir = path.join(tempRoot, "source-profile");
  const automationUserDataDir = path.join(tempRoot, "automation-profile");
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const extensionDir = path.join(sourceUserDataDir, "Default", "Extensions", extensionId, "1.0.0");
  await fs.mkdir(extensionDir, { recursive: true });
  await fs.writeFile(
    path.join(extensionDir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Clipper launch test",
      version: "1.0.0",
    }),
    "utf8",
  );

  let session;
  try {
    session = await launchChromeContext({
      chromePath: systemChromePath,
      userDataDir: sourceUserDataDir,
      automationUserDataDir,
      profileDirectory: "Default",
      extensionId,
    });

    const page = await session.context.newPage();
    await page.goto("about:blank");
    assert.match(await page.evaluate(() => navigator.userAgent), /Chrome/);
  } finally {
    await session?.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("launchChromeContext exposes the configured Web Clipper worker", {
  skip: !integrationReady,
}, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-worker-"));
  let session;
  try {
    session = await launchChromeContext({
      ...integrationConfig,
      chromePath: chromeForTestingPath,
      automationUserDataDir: path.join(tempRoot, "automation-profile"),
    });

    const worker = await getExtensionWorker(session.context, integrationConfig.extensionId);
    assert.equal(
      await worker.evaluate(() => typeof chrome?.storage?.sync?.get === "function"),
      true,
    );
  } finally {
    await session?.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
