import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function findInstalledExtensionVersion(extensionRoot) {
  if (!(await pathExists(extensionRoot))) {
    return null;
  }

  const entries = await fs.readdir(extensionRoot, { withFileTypes: true });
  const versions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  return versions[0] ?? null;
}

export async function isChromeRunning() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV"]);
      return stdout.toLowerCase().includes("chrome.exe");
    } catch (error) {
      throw new Error(`Failed to inspect Chrome processes: ${error.message}`);
    }
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", "chrome"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function launchChromeContext(config) {
  const automationDir = config.automationUserDataDir;
  await prepareAutomationProfile(config.userDataDir, automationDir, config.profileDirectory, config.extensionId);
  const extensionRoot = `${config.userDataDir}/${config.profileDirectory}/Extensions/${config.extensionId}`.replace(/\\/g, "/");
  const extensionVersion = await findInstalledExtensionVersion(extensionRoot);
  if (!extensionVersion) {
    throw new Error(`Could not find extension files for ${config.extensionId}`);
  }
  const extensionPath = `${extensionRoot}/${extensionVersion}`.replace(/\\/g, "/");
  const context = await chromium.launchPersistentContext(automationDir, {
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--start-maximized",
    ],
  });

  return {
    context,
    async close() {
      await context.close().catch(() => {});
    },
  };
}

export async function configureExtensionForAutomation(worker) {
  return worker.evaluate(async () => {
    const current = await chrome.storage.sync.get(["general_settings", "vaults", "stats"]);
    const generalSettings = {
      ...(current.general_settings ?? {}),
      openBehavior: "embedded",
      saveBehavior: "addToObsidian",
      silentOpen: true,
    };

    await chrome.storage.sync.set({ general_settings: generalSettings });

    return {
      generalSettings,
      vaults: current.vaults ?? [],
      stats: current.stats ?? {},
    };
  });
}

export async function getActiveTabId(worker) {
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  });
}

export async function getExtensionWorker(context, extensionId) {
  const extensionOrigin = `chrome-extension://${extensionId}/`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith(extensionOrigin));
    if (worker) {
      return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const wakePage = await context.newPage();
  try {
    await wakePage.goto(`${extensionOrigin}settings.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith(extensionOrigin));
      if (worker) {
        return worker;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await wakePage.close().catch(() => {});
  }

  throw new Error(`Timed out waiting for extension worker: ${extensionOrigin}`);
}

export async function toggleClipperIframe(worker, tabId) {
  return worker.evaluate(async ({ tabId }) => {
    function sendToTab(message) {
      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(response);
        });
      });
    }

    async function ensureContentScript() {
      try {
        await sendToTab({ action: "ping" });
      } catch {
        await new Promise((resolve, reject) => {
          chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve();
          });
        });
      }
    }

    await ensureContentScript();
    return sendToTab({ action: "toggle-iframe" });
  }, { tabId });
}

export async function closeClipperIframe(worker, tabId) {
  return worker.evaluate(async ({ tabId }) => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "close-iframe" }, () => resolve(null));
    });
  }, { tabId });
}

async function prepareAutomationProfile(sourceUserDataDir, targetUserDataDir, profileDirectory, extensionId) {
  await fs.rm(targetUserDataDir, { recursive: true, force: true });
  const sourceProfileDir = `${sourceUserDataDir}/${profileDirectory}`.replace(/\\/g, "/");
  const targetProfileDir = `${targetUserDataDir}/${profileDirectory}`.replace(/\\/g, "/");

  await fs.mkdir(targetProfileDir, { recursive: true });

  const sourcePreferences = `${sourceProfileDir}/Preferences`;
  const targetPreferences = `${targetProfileDir}/Preferences`;
  if (await pathExists(sourcePreferences)) {
    await fs.copyFile(sourcePreferences, targetPreferences);
    await patchProfilePreferences(targetPreferences, extensionId);
  }

  const scopedDirs = [
    `Local Extension Settings/${extensionId}`,
    `Sync Extension Settings/${extensionId}`,
  ];

  for (const relativeDir of scopedDirs) {
    const sourceDir = `${sourceProfileDir}/${relativeDir}`.replace(/\\/g, "/");
    const targetDir = `${targetProfileDir}/${relativeDir}`.replace(/\\/g, "/");
    if (await pathExists(sourceDir)) {
      await fs.mkdir(targetDir.substring(0, targetDir.lastIndexOf("/")), { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true });
    }
  }
}

async function patchProfilePreferences(preferencesPath, extensionId) {
  const preferences = JSON.parse(await fs.readFile(preferencesPath, "utf8"));
  const extensionOrigin = `chrome-extension://${extensionId}`;

  preferences.protocol_handler ??= {};
  preferences.protocol_handler.allowed_origin_protocol_pairs ??= {};
  preferences.protocol_handler.allowed_origin_protocol_pairs[extensionOrigin] ??= {};
  preferences.protocol_handler.allowed_origin_protocol_pairs[extensionOrigin].obsidian = true;

  await fs.writeFile(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}
