import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDir, fileExists, readJson, writeJson } from "./fs-utils.js";

const __filename = fileURLToPath(import.meta.url);
const libDir = path.dirname(__filename);
const scriptsDir = path.dirname(libDir);
export const skillRoot = path.dirname(scriptsDir);
export const localDir = path.join(skillRoot, "local");
export const configPath = path.join(localDir, "config.json");
export const runsDir = path.join(localDir, "runs");
export const automationUserDataDir = path.join(localDir, "automation-user-data");

export function makeDefaultConfig() {
  const localAppData = process.env.LOCALAPPDATA ?? "C:/Users/haodo/AppData/Local";

  return {
    chromePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    userDataDir: path.join(localAppData, "Google", "Chrome", "User Data").replace(/\\/g, "/"),
    automationUserDataDir: automationUserDataDir.replace(/\\/g, "/"),
    profileDirectory: "Default",
    extensionId: "cnjifjpddelmedmihgijeibhnjfabmlf",
    openShortcut: "Ctrl+Shift+O",
    summaryTimeoutMs: 240000,
    postAddTimeoutMs: 7000,
    maxConcurrentSummaries: 18,
    scrollStepPx: 900,
    scrollPauseMs: 250,
  };
}

export function applyEnvOverrides(config) {
  const overrides = { ...config };
  const maxConcurrencyOverride = process.env.OBSIDIAN_CLIPPER_MAX_CONCURRENCY;

  if (maxConcurrencyOverride) {
    const parsed = Number.parseInt(maxConcurrencyOverride, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      overrides.maxConcurrentSummaries = parsed;
    }
  }

  return overrides;
}

export function validateConfig(config) {
  const requiredStringFields = [
    "chromePath",
    "userDataDir",
    "automationUserDataDir",
    "profileDirectory",
    "extensionId",
    "openShortcut",
  ];
  for (const field of requiredStringFields) {
    if (!config?.[field] || typeof config[field] !== "string") {
      throw new Error(`Config field "${field}" is required.`);
    }
  }

  const requiredNumberFields = [
    "summaryTimeoutMs",
    "postAddTimeoutMs",
    "maxConcurrentSummaries",
    "scrollStepPx",
    "scrollPauseMs",
  ];
  for (const field of requiredNumberFields) {
    if (typeof config?.[field] !== "number" || Number.isNaN(config[field]) || config[field] <= 0) {
      throw new Error(`Config field "${field}" must be a positive number.`);
    }
  }
}

export async function ensureLocalLayout() {
  await ensureDir(localDir);
  await ensureDir(runsDir);
}

export async function hasConfig() {
  return fileExists(configPath);
}

export async function loadConfig() {
  const config = applyEnvOverrides({
    ...makeDefaultConfig(),
    ...(await readJson(configPath)),
  });
  validateConfig(config);
  return config;
}

export async function saveConfig(config) {
  validateConfig(config);
  await ensureLocalLayout();
  await writeJson(configPath, config);
}

export function extensionVersionDir(config) {
  return path.join(config.userDataDir, config.profileDirectory, "Extensions", config.extensionId);
}

export function profilePath(config) {
  return path.join(config.userDataDir, config.profileDirectory);
}
