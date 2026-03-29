import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  canonicalizeUrl,
  classifySkipReason,
  dedupeKey,
  extractUrlsFromText,
  incrementCount,
  newCaptureSessionId,
} from "./common.js";

const execFileAsync = promisify(execFile);

const FILE_HELPER_NAMES = ["文件传输助手", "File Transfer Assistant", "File Transfer", "filehelper"];

const ESSENTIAL_FILES = {
  key_info_db: ["all_users", "login-account", "key_info.db"],
  message_db: ["account", "db_storage", "message", "message_0.db"],
  session_db: ["account", "db_storage", "session", "session.db"],
  contact_db: ["account", "db_storage", "contact", "contact.db"],
};

const SESSION_NAME_COLUMNS = [
  "chat_name",
  "session_name",
  "display_name",
  "name",
  "nickname",
  "remark",
  "user_name",
  "talker",
  "session_key",
];

const SESSION_ID_COLUMNS = [
  "session_id",
  "conversation_id",
  "chat_id",
  "session_key",
  "talker",
  "user_name",
  "username",
  "local_id",
  "id",
];

const MESSAGE_SESSION_COLUMNS = [
  "session_id",
  "conversation_id",
  "chat_id",
  "session_key",
  "talker",
  "user_name",
];

const MESSAGE_TIME_COLUMNS = [
  "message_time",
  "create_time",
  "create_at",
  "send_time",
  "timestamp",
  "msg_time",
  "sort_time",
];

const MESSAGE_ID_COLUMNS = ["message_id", "msg_id", "local_id", "server_id", "id"];
const MESSAGE_URL_COLUMNS = ["url", "link_url", "target_url", "content_url", "open_url", "source_url"];
const MESSAGE_TITLE_COLUMNS = ["title", "link_title", "content_title", "msg_title", "headline"];
const MESSAGE_TEXT_COLUMNS = ["content", "body", "text", "raw_xml", "xml", "payload", "description", "brief"];
const MESSAGE_TYPE_COLUMNS = ["message_type", "type", "msg_type", "sub_type", "content_type", "kind"];

export async function probeWeChatStore({ homeDir = process.env.HOME, debug = false } = {}) {
  const containerDir = path.join(homeDir, "Library/Containers/com.tencent.xinWeChat");
  const xwechatFilesDir = path.join(containerDir, "Data/Documents/xwechat_files");
  const allUsersDir = path.join(xwechatFilesDir, "all_users");
  const loginRootDir = path.join(allUsersDir, "login");

  const probe = {
    home_dir: homeDir,
    container_dir: containerDir,
    xwechat_files_dir: xwechatFilesDir,
    container_found: false,
    active_account_found: false,
    active_account_dir: null,
    login_account_dir: null,
    files: {
      key_info_db: null,
      message_db: null,
      session_db: null,
      contact_db: null,
    },
    file_presence: {
      key_info_db: false,
      message_db: false,
      session_db: false,
      contact_db: false,
    },
    database_readability: {
      key_info_db: "missing",
      message_db: "missing",
      session_db: "missing",
      contact_db: "missing",
    },
    sqlite_available: true,
    store_probe_status: "missing",
    reasons: [],
  };

  probe.container_found = await pathExists(containerDir);
  if (!probe.container_found) {
    probe.reasons.push("WeChat container directory was not found.");
    return probe;
  }

  const accountDirs = await findAccountDirs(xwechatFilesDir);
  if (accountDirs.length === 0) {
    probe.reasons.push("No active account directory with db_storage was found.");
    return probe;
  }

  const activeAccountDir = await selectNewestAccountDir(accountDirs);
  probe.active_account_found = Boolean(activeAccountDir);
  probe.active_account_dir = activeAccountDir;
  if (!activeAccountDir) {
    probe.reasons.push("Could not determine the active account directory.");
    return probe;
  }

  const loginAccountDir = await findLoginAccountDir(loginRootDir, path.basename(activeAccountDir));
  probe.login_account_dir = loginAccountDir;

  probe.files = {
    key_info_db: loginAccountDir ? path.join(loginAccountDir, "key_info.db") : null,
    message_db: path.join(activeAccountDir, "db_storage/message/message_0.db"),
    session_db: path.join(activeAccountDir, "db_storage/session/session.db"),
    contact_db: path.join(activeAccountDir, "db_storage/contact/contact.db"),
  };

  for (const [name, filePath] of Object.entries(probe.files)) {
    if (!filePath) continue;
    probe.file_presence[name] = await pathExists(filePath);
  }

  const missingRequired = Object.entries(ESSENTIAL_FILES)
    .map(([key]) => key)
    .filter((key) => !probe.file_presence[key]);
  if (missingRequired.length > 0) {
    probe.reasons.push(`Missing required store files: ${missingRequired.join(", ")}`);
    return probe;
  }

  for (const [name, filePath] of Object.entries(probe.files)) {
    if (!filePath) continue;
    const readability = await probeSqliteReadability(filePath);
    probe.database_readability[name] = readability;
    if (readability === "sqlite_unavailable") {
      probe.sqlite_available = false;
    }
  }

  const requiredReadability = [
    probe.database_readability.message_db,
    probe.database_readability.session_db,
    probe.database_readability.contact_db,
  ];

  if (requiredReadability.every((state) => state === "readable")) {
    probe.store_probe_status = "readable";
    return probe;
  }

  probe.store_probe_status = "encrypted_unreadable";
  const unreadable = Object.entries(probe.database_readability)
    .filter(([, state]) => state !== "readable" && state !== "missing")
    .map(([key, state]) => `${key}:${state}`);
  if (unreadable.length > 0) {
    probe.reasons.push(`Store files exist but are not directly readable: ${unreadable.join(", ")}`);
  }
  if (!probe.sqlite_available) {
    probe.reasons.push("The sqlite3 CLI is unavailable, so readable store scanning cannot run.");
  }

  if (debug) {
    probe.reasons.push(`Debug: accountDirs=${accountDirs.join(", ")}`);
  }

  return probe;
}

export function formatProbeReport(probe) {
  const lines = [
    "WeChat macOS store probe",
    "=".repeat(50),
    `Container found   : ${probe.container_found ? "yes" : "no"}`,
    `Active account    : ${probe.active_account_dir ?? "(not found)"}`,
    `Login account dir : ${probe.login_account_dir ?? "(not found)"}`,
    `Probe status      : ${probe.store_probe_status}`,
  ];

  for (const [name, filePath] of Object.entries(probe.files)) {
    lines.push(
      `${name.padEnd(16)}: ${filePath ?? "(missing)"} [${probe.database_readability[name]}]`
    );
  }

  if (probe.reasons.length > 0) {
    lines.push("");
    lines.push("Reasons:");
    for (const reason of probe.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  return lines.join("\n");
}

export async function scanStoreLinks({ probe, since, until, debug = false } = {}) {
  if (!probe || probe.store_probe_status !== "readable") {
    throw new Error("Store scanning requires a readable probe result.");
  }

  const sessionMatch = await findFileHelperSession(probe.files.session_db, debug);
  const stats = {
    source: "store",
    session_found: Boolean(sessionMatch),
    share_cards_seen: 0,
    share_cards_unresolved: 0,
    skipped_by_rule: {},
  };

  if (!sessionMatch) {
    return { records: [], stats };
  }

  if (debug) {
    console.log(`[debug] store session: ${sessionMatch.table}.${sessionMatch.sessionIdColumn}=${sessionMatch.sessionId}`);
  }

  const messageRows = await loadStoreMessages(probe.files.message_db, sessionMatch, debug);
  const records = [];
  const seenKeys = new Set();
  const sessionId = newCaptureSessionId();
  const chatName = sessionMatch.chatName || FILE_HELPER_NAMES[0];

  for (const row of messageRows) {
    const messageTime = normalizeMessageTime(
      firstPresentValue(row.data, row.meta.timeColumns),
      since,
      until
    );
    if (!messageTime || messageTime < since || messageTime > until) {
      continue;
    }

    const title = firstPresentString(row.data, row.meta.titleColumns);
    const explicitUrls = row.meta.urlColumns
      .map((column) => row.data[column])
      .map((value) => (value == null ? "" : String(value).trim()))
      .filter(Boolean);
    const textPayload = row.meta.textColumns
      .map((column) => row.data[column])
      .map((value) => (value == null ? "" : String(value)))
      .filter(Boolean)
      .join("\n");
    const extractedUrls = [
      ...explicitUrls,
      ...extractUrlsFromText(textPayload),
    ];

    const shareCardLike = isShareCardRow(row.data, row.meta);
    if (shareCardLike) {
      stats.share_cards_seen += 1;
    }

    if (extractedUrls.length === 0) {
      if (shareCardLike) {
        stats.share_cards_unresolved += 1;
      }
      continue;
    }

    for (const rawUrl of extractedUrls) {
      const canonicalUrl = canonicalizeUrl(rawUrl);
      const skipReason = classifySkipReason(canonicalUrl);
      if (skipReason) {
        incrementCount(stats.skipped_by_rule, skipReason);
        continue;
      }

      const messageType = shareCardLike ? "share_card" : "text_url";
      const dedupe = dedupeKey(chatName, messageTime.toISOString(), canonicalUrl);
      if (seenKeys.has(dedupe)) continue;
      seenKeys.add(dedupe);

      records.push({
        captured_at: new Date().toISOString(),
        message_time: messageTime.toISOString(),
        chat_name: chatName,
        message_type: messageType,
        title: title ?? "",
        url: canonicalUrl,
        dedupe_key: dedupe,
        capture_session_id: sessionId,
        source: "store",
        source_message_id: row.sourceMessageId,
      });
    }
  }

  return { records, stats };
}

async function findAccountDirs(xwechatFilesDir) {
  if (!(await pathExists(xwechatFilesDir))) return [];
  const entries = await fs.readdir(xwechatFilesDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "all_users" || entry.name === "Backup") continue;
    const candidate = path.join(xwechatFilesDir, entry.name);
    if (await pathExists(path.join(candidate, "db_storage"))) {
      dirs.push(candidate);
    }
  }
  return dirs;
}

async function selectNewestAccountDir(accountDirs) {
  if (accountDirs.length === 0) return null;
  const scored = await Promise.all(
    accountDirs.map(async (dir) => ({
      dir,
      mtimeMs: await getNewestRelevantMtime(dir),
    }))
  );
  scored.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return scored[0]?.dir ?? null;
}

async function getNewestRelevantMtime(accountDir) {
  const candidates = [
    path.join(accountDir, "db_storage/message/message_0.db"),
    path.join(accountDir, "db_storage/session/session.db"),
    path.join(accountDir, "db_storage/contact/contact.db"),
  ];

  let newest = 0;
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      newest = Math.max(newest, stat.mtimeMs);
    } catch {
      // ignore
    }
  }
  return newest;
}

async function findLoginAccountDir(loginRootDir, activeAccountName) {
  if (!(await pathExists(loginRootDir))) return null;
  const entries = await fs.readdir(loginRootDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const matched = dirs.find((name) => activeAccountName.startsWith(name));
  if (matched) {
    return path.join(loginRootDir, matched);
  }
  return dirs.length === 1 ? path.join(loginRootDir, dirs[0]) : null;
}

async function probeSqliteReadability(filePath) {
  if (!(await pathExists(filePath))) return "missing";
  try {
    await execFileAsync("sqlite3", [filePath, ".tables"], {
      timeout: 5_000,
      encoding: "utf8",
    });
    return "readable";
  } catch (err) {
    const stderr = `${err.stderr ?? ""}${err.stdout ?? ""}${err.message ?? ""}`.toLowerCase();
    if (stderr.includes("unable to open database") && stderr.includes("sqlite3")) {
      return "sqlite_unavailable";
    }
    if (stderr.includes("file is not a database")) return "encrypted_unreadable";
    return "encrypted_unreadable";
  }
}

async function findFileHelperSession(sessionDbPath, debug) {
  const tables = await listTables(sessionDbPath);
  const orderedTables = tables.sort((a, b) => scoreSessionTableName(b) - scoreSessionTableName(a));

  for (const table of orderedTables) {
    const columns = await getTableColumns(sessionDbPath, table);
    const nameColumns = preferColumns(columns, SESSION_NAME_COLUMNS, /name|talker|session/i);
    if (nameColumns.length === 0) continue;

    const idColumns = preferColumns(columns, SESSION_ID_COLUMNS);
    for (const nameColumn of nameColumns) {
      const rows = await queryJson(
        sessionDbPath,
        `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(nameColumn)} IN (${FILE_HELPER_NAMES.map(sqlLiteral).join(", ")}) LIMIT 5`
      );
      if (rows.length === 0) continue;

      const row = rows[0];
      const sessionIdColumn = firstExistingColumn(row, [...idColumns, nameColumn]);
      if (!sessionIdColumn) continue;

      if (debug) {
        console.log(`[debug] matched session table ${table} via ${nameColumn}`);
      }

      return {
        table,
        chatName: String(row[nameColumn] ?? FILE_HELPER_NAMES[0]),
        sessionIdColumn,
        sessionId: row[sessionIdColumn],
      };
    }
  }

  return null;
}

async function loadStoreMessages(messageDbPath, sessionMatch, debug) {
  const tables = await listTables(messageDbPath);
  const orderedTables = tables.sort((a, b) => scoreMessageTableName(b) - scoreMessageTableName(a));

  for (const table of orderedTables) {
    const columns = await getTableColumns(messageDbPath, table);
    const sessionColumns = preferColumns(columns, MESSAGE_SESSION_COLUMNS);
    const timeColumns = preferColumns(columns, MESSAGE_TIME_COLUMNS);
    if (sessionColumns.length === 0 || timeColumns.length === 0) continue;

    const sessionColumn = sessionColumns[0];
    const timeColumn = timeColumns[0];
    const rows = await queryJson(
      messageDbPath,
      `SELECT * FROM ${quoteIdentifier(table)}
       WHERE ${quoteIdentifier(sessionColumn)} = ${sqlLiteral(sessionMatch.sessionId)}
       ORDER BY ${quoteIdentifier(timeColumn)} DESC
       LIMIT 5000`
    );
    if (rows.length === 0) continue;

    if (debug) {
      console.log(`[debug] matched message table ${table}, rows=${rows.length}`);
    }

    const meta = {
      sessionColumn,
      timeColumns,
      idColumns: preferColumns(columns, MESSAGE_ID_COLUMNS),
      urlColumns: preferColumns(columns, MESSAGE_URL_COLUMNS),
      titleColumns: preferColumns(columns, MESSAGE_TITLE_COLUMNS),
      textColumns: preferColumns(columns, MESSAGE_TEXT_COLUMNS, /content|body|text|xml|payload|desc/i),
      typeColumns: preferColumns(columns, MESSAGE_TYPE_COLUMNS),
    };

    return rows.map((row) => ({
      data: row,
      sourceMessageId: stringifyIfPresent(firstPresentValue(row, meta.idColumns)),
      meta,
    }));
  }

  return [];
}

async function listTables(dbPath) {
  const rows = await queryJson(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  return rows.map((row) => row.name).filter(Boolean);
}

async function getTableColumns(dbPath, table) {
  const rows = await queryJson(dbPath, `PRAGMA table_info(${quoteIdentifier(table)})`);
  return rows.map((row) => row.name).filter(Boolean);
}

async function queryJson(dbPath, sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    timeout: 15_000,
    encoding: "utf8",
  });
  const text = stdout.trim();
  if (!text) return [];
  return JSON.parse(text);
}

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function preferColumns(columns, preferredNames, pattern = null) {
  const set = new Set(columns);
  const ordered = preferredNames.filter((name) => set.has(name));
  for (const column of columns) {
    if (ordered.includes(column)) continue;
    if (pattern && pattern.test(column)) {
      ordered.push(column);
    }
  }
  return ordered;
}

function firstExistingColumn(row, columns) {
  return columns.find((column) => row[column] != null);
}

function firstPresentValue(row, columns) {
  const column = firstExistingColumn(row, columns);
  return column ? row[column] : null;
}

function firstPresentString(row, columns) {
  const value = firstPresentValue(row, columns);
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function stringifyIfPresent(value) {
  return value == null ? undefined : String(value);
}

function normalizeMessageTime(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  let millis = numeric;
  if (numeric > 1e17) {
    millis = numeric / 1e6;
  } else if (numeric > 1e14) {
    millis = numeric / 1e3;
  } else if (numeric > 1e11) {
    millis = numeric;
  } else if (numeric > 1e9) {
    millis = numeric * 1e3;
  } else {
    return null;
  }

  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isShareCardRow(row, meta) {
  const explicitType = meta.typeColumns
    .map((column) => row[column])
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase());
  if (explicitType.some((value) => /share|card|article|link|app/.test(value))) {
    return true;
  }

  if (meta.titleColumns.some((column) => row[column] != null && String(row[column]).trim() !== "")) {
    return true;
  }

  const textPayload = meta.textColumns
    .map((column) => row[column])
    .filter((value) => value != null)
    .map((value) => String(value))
    .join("\n");
  return textPayload.includes("[链接]") || /appmsg|mp\.weixin\.qq\.com/.test(textPayload);
}

function scoreSessionTableName(tableName) {
  return Number(/session/i.test(tableName)) * 10 + Number(/chat|conversation/i.test(tableName)) * 5;
}

function scoreMessageTableName(tableName) {
  return Number(/^message/i.test(tableName)) * 10 + Number(/message/i.test(tableName)) * 5;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
