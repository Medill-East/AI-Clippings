import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class ClippingNamingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClippingNamingError";
    this.code = code;
  }
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;

  let date;
  if (typeof value === "number") {
    date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
  } else if (typeof value === "string" && /^\d{10}$/.test(value)) {
    date = new Date(Number(value) * 1_000);
  } else if (typeof value === "string" && /^\d{13}$/.test(value)) {
    date = new Date(Number(value));
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}${values.day}`;
}

function normalizePortableTitle(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} -]+/gu, " ")
    .replace(/ {2,}/gu, " ")
    .replace(/-{2,}/gu, "-")
    .replace(/^[ -]+|[ -]+$/gu, "");
}

function truncateCodePoints(value, maxLength) {
  return Array.from(value).slice(0, Math.max(0, maxLength)).join("");
}

export function buildPortableClippingStem({
  title,
  publishedAt,
  collectedAt,
  maxLength = 100,
  timeZone = "Asia/Shanghai",
}) {
  const publishedDate = parseDate(publishedAt);
  const collectedDate = parseDate(collectedAt);
  const date = publishedDate ?? collectedDate;
  if (!date) {
    throw new ClippingNamingError(
      "published_missing",
      "No valid published or collected date",
    );
  }

  const limit = Math.min(100, Math.max(0, Math.floor(Number(maxLength))));
  const dateSource = publishedDate ? "published" : "collected";
  const dateString = formatDate(date, timeZone);
  const prefix = `${dateString}-`;
  const portableTitle = truncateCodePoints(
    normalizePortableTitle(title),
    limit - Array.from(prefix).length,
  ).replace(/[ -]+$/u, "");

  if (!portableTitle) {
    throw new ClippingNamingError(
      "title_unusable",
      "No portable title remains after normalization",
    );
  }

  return {
    date: dateString,
    dateSource,
    portableTitle,
    stem: `${prefix}${portableTitle}`,
  };
}

export function addStableSourceSuffix(stem, sourceUrl, maxLength = 100) {
  const limit = Math.min(100, Math.max(0, Math.floor(Number(maxLength))));
  const hash = createHash("sha256")
    .update(String(sourceUrl))
    .digest("hex")
    .slice(0, 8);
  const suffix = `-${hash}`;
  const base = String(stem ?? "").replace(/[ .-]+$/u, "");

  if (limit <= Array.from(suffix).length) {
    return truncateCodePoints(hash, limit);
  }
  return `${truncateCodePoints(base, limit - Array.from(suffix).length).replace(/[ .-]+$/u, "")}${suffix}`;
}

async function readSource(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, source: null };
    throw error;
  }

  const frontmatter =
    content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1] ?? "";
  const sourceKeys = [...frontmatter.matchAll(/^source\s*:/gmu)];
  const sourceLine =
    sourceKeys.length === 1
      ? /^source\s*:\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/mu.exec(frontmatter)
      : null;
  return {
    exists: true,
    source:
      sourceLine?.[1] ?? sourceLine?.[2] ?? sourceLine?.[3] ?? null,
  };
}

export async function choosePortableNotePath({ directory, stem, sourceUrl }) {
  const basePath = path.join(directory, `${stem}.md`);
  const base = await readSource(basePath);
  if (!base.exists) {
    return { path: basePath, reused: false, conflicted: false };
  }
  if (base.source === sourceUrl) {
    return { path: basePath, reused: true, conflicted: false };
  }

  const suffixedPath = path.join(
    directory,
    `${addStableSourceSuffix(stem, sourceUrl)}.md`,
  );
  const suffixed = await readSource(suffixedPath);
  if (!suffixed.exists) {
    return { path: suffixedPath, reused: false, conflicted: true };
  }
  if (suffixed.source === sourceUrl) {
    return { path: suffixedPath, reused: true, conflicted: true };
  }

  throw new ClippingNamingError(
    "note_name_conflict",
    `No available note path for ${sourceUrl}`,
  );
}
