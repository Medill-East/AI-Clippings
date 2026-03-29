import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ACCOUNT_LOGIN = "wxid_test";
const ACCOUNT_DIR = `${ACCOUNT_LOGIN}_abcd`;

export async function createReadableWeChatHome(homeDir, { messages = [] } = {}) {
  const paths = getFixturePaths(homeDir);
  await createBaseDirs(paths);
  await createKeyInfoDb(paths.keyInfoDbPath);
  await createSessionDb(paths.sessionDbPath);
  await createContactDb(paths.contactDbPath);
  await createMessageDb(paths.messageDbPath, messages);
  return paths;
}

export async function createUnreadableWeChatHome(homeDir) {
  const paths = getFixturePaths(homeDir);
  await createBaseDirs(paths);
  await createKeyInfoDb(paths.keyInfoDbPath);
  await fs.writeFile(paths.sessionDbPath, "not a database", "utf8");
  await fs.writeFile(paths.contactDbPath, "not a database", "utf8");
  await fs.writeFile(paths.messageDbPath, "not a database", "utf8");
  return paths;
}

export async function createMissingStoreWeChatHome(homeDir) {
  const paths = getFixturePaths(homeDir);
  await fs.mkdir(path.dirname(paths.keyInfoDbPath), { recursive: true });
  await createKeyInfoDb(paths.keyInfoDbPath);
  return paths;
}

function getFixturePaths(homeDir) {
  const containerDir = path.join(homeDir, "Library/Containers/com.tencent.xinWeChat");
  const xwechatFilesDir = path.join(containerDir, "Data/Documents/xwechat_files");
  const accountDir = path.join(xwechatFilesDir, ACCOUNT_DIR);
  const loginDir = path.join(xwechatFilesDir, "all_users/login", ACCOUNT_LOGIN);

  return {
    homeDir,
    containerDir,
    accountDir,
    loginDir,
    keyInfoDbPath: path.join(loginDir, "key_info.db"),
    sessionDbPath: path.join(accountDir, "db_storage/session/session.db"),
    contactDbPath: path.join(accountDir, "db_storage/contact/contact.db"),
    messageDbPath: path.join(accountDir, "db_storage/message/message_0.db"),
  };
}

async function createBaseDirs(paths) {
  await fs.mkdir(path.dirname(paths.keyInfoDbPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.sessionDbPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.contactDbPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.messageDbPath), { recursive: true });
}

async function createKeyInfoDb(dbPath) {
  runSqlite(
    dbPath,
    `
    CREATE TABLE LoginKeyInfoTable(
      user_name_md5 TEXT,
      key_md5 TEXT,
      key_info_md5 TEXT,
      key_info_data BLOB
    );
    INSERT INTO LoginKeyInfoTable VALUES ('user', 'key', 'info', X'01');
    `
  );
}

async function createSessionDb(dbPath) {
  runSqlite(
    dbPath,
    `
    CREATE TABLE sessions(
      session_id TEXT PRIMARY KEY,
      chat_name TEXT NOT NULL
    );
    INSERT INTO sessions VALUES ('filehelper', '文件传输助手');
    INSERT INTO sessions VALUES ('other', '其他聊天');
    `
  );
}

async function createContactDb(dbPath) {
  runSqlite(
    dbPath,
    `
    CREATE TABLE contacts(
      user_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );
    INSERT INTO contacts VALUES ('filehelper', '文件传输助手');
    `
  );
}

async function createMessageDb(dbPath, messages) {
  runSqlite(
    dbPath,
    `
    CREATE TABLE messages(
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_time INTEGER NOT NULL,
      message_type TEXT,
      title TEXT,
      url TEXT,
      content TEXT
    );
    `
  );

  for (const message of messages) {
    runSqlite(
      dbPath,
      `
      INSERT INTO messages(message_id, session_id, message_time, message_type, title, url, content)
      VALUES (
        ${sqlLiteral(message.message_id)},
        ${sqlLiteral(message.session_id ?? "filehelper")},
        ${sqlLiteral(message.message_time)},
        ${sqlLiteral(message.message_type ?? null)},
        ${sqlLiteral(message.title ?? null)},
        ${sqlLiteral(message.url ?? null)},
        ${sqlLiteral(message.content ?? null)}
      );
      `
    );
  }
}

function runSqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
