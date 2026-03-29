import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { probeWeChatStore } from "../scripts/lib/store.js";
import {
  createMissingStoreWeChatHome,
  createReadableWeChatHome,
  createUnreadableWeChatHome,
} from "./helpers/store-fixture.js";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

async function makeTempHome() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wechat-filehelper-store-"));
  tempDirs.push(dir);
  return dir;
}

describe("probeWeChatStore", () => {
  it("reports a complete readable store", async () => {
    const homeDir = await makeTempHome();
    await createReadableWeChatHome(homeDir, {
      messages: [
        {
          message_id: "m1",
          message_time: 1774684800000,
          url: "https://example.com/article",
          content: "https://example.com/article",
        },
      ],
    });

    const probe = await probeWeChatStore({ homeDir });
    assert.equal(probe.store_probe_status, "readable");
    assert.equal(probe.container_found, true);
    assert.equal(probe.active_account_found, true);
    assert.equal(probe.file_presence.message_db, true);
    assert.equal(probe.database_readability.message_db, "readable");
    assert.match(probe.active_account_dir ?? "", /wxid_test_abcd$/);
  });

  it("reports missing when the account store is incomplete", async () => {
    const homeDir = await makeTempHome();
    await createMissingStoreWeChatHome(homeDir);

    const probe = await probeWeChatStore({ homeDir });
    assert.equal(probe.store_probe_status, "missing");
    assert.equal(probe.file_presence.message_db, false);
    assert.ok(
      probe.reasons.some(
        (reason) =>
          reason.includes("No active account directory") ||
          reason.includes("Missing required store files")
      )
    );
  });

  it("reports encrypted_unreadable when db files exist but are not directly readable", async () => {
    const homeDir = await makeTempHome();
    await createUnreadableWeChatHome(homeDir);

    const probe = await probeWeChatStore({ homeDir });
    assert.equal(probe.store_probe_status, "encrypted_unreadable");
    assert.equal(probe.file_presence.message_db, true);
    assert.equal(probe.database_readability.message_db, "encrypted_unreadable");
  });
});
