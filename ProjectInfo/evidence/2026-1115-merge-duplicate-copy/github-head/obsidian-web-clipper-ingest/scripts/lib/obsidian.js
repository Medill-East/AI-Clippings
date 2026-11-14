import fs from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./chrome.js";

const OBSIDIAN_CONFIG_PATHS = [
  "C:/Users/haodo/AppData/Roaming/obsidian/obsidian.json",
  "C:/Users/haodo/AppData/Roaming/Obsidian/obsidian.json",
];

const IGNORED_DIRECTORIES = new Set([".git", ".obsidian", "node_modules"]);

export function normalizeNoteStem(value) {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function chooseVaultCandidate(candidates, preferredVaultNames = []) {
  const preferredNames = new Set(preferredVaultNames.map((name) => name.toLowerCase()));
  const preferred = candidates.filter((candidate) => preferredNames.has(candidate.name.toLowerCase()));
  const pool = preferred.length > 0 ? preferred : candidates;

  return pool
    .slice()
    .sort((left, right) => {
      if (Boolean(left.open) !== Boolean(right.open)) {
        return left.open ? -1 : 1;
      }
      return (right.ts ?? 0) - (left.ts ?? 0);
    })[0] ?? null;
}

export async function resolveObsidianVault(preferredVaultNames = []) {
  const candidates = [];

  for (const configPath of OBSIDIAN_CONFIG_PATHS) {
    if (!(await pathExists(configPath))) {
      continue;
    }

    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    for (const vault of Object.values(parsed.vaults ?? {})) {
      if (!vault?.path) {
        continue;
      }

      candidates.push({
        name: path.basename(vault.path),
        open: Boolean(vault.open),
        path: vault.path,
        ts: vault.ts ?? 0,
      });
    }
  }

  return chooseVaultCandidate(candidates, preferredVaultNames);
}

export async function waitForImportedNote({
  noteName,
  sourceUrl,
  title,
  vaultPath,
  startedAfterMs,
  timeoutMs,
}) {
  const expectedNames = new Set([noteName, title].filter(Boolean).map(normalizeNoteStem).filter(Boolean));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const markdownFiles = await collectMarkdownFiles(vaultPath);

    for (const filePath of markdownFiles) {
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats || stats.mtimeMs + 1000 < startedAfterMs) {
        continue;
      }

      const fileStem = normalizeNoteStem(path.parse(filePath).name);
      let matchedBy = expectedNames.has(fileStem) ? "note-name" : "";

      if (!matchedBy && (sourceUrl || title)) {
        const content = await fs.readFile(filePath, "utf8").catch(() => "");
        if (sourceUrl && content.includes(sourceUrl)) {
          matchedBy = "source-url";
        } else if (title && content.includes(title)) {
          matchedBy = "title";
        }
      }

      if (matchedBy) {
        return {
          filePath,
          matchedBy,
          modifiedAt: new Date(stats.mtimeMs).toISOString(),
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

async function collectMarkdownFiles(rootPath) {
  const files = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(entryPath);
      }
    }
  }

  return files;
}
