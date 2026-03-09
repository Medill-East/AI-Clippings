import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseInputUrls } from "../scripts/lib/urls.js";

test("parseInputUrls accepts direct URLs", async () => {
  const urls = await parseInputUrls(["https://example.com", "https://example.org"]);
  assert.deepEqual(urls, ["https://example.com", "https://example.org"]);
});

test("parseInputUrls accepts --input files", async () => {
  const tempFile = path.join(os.tmpdir(), `clipper-urls-${Date.now()}.txt`);
  await fs.writeFile(tempFile, "# comment\nhttps://example.com\n\nhttps://example.org\n", "utf8");

  try {
    const urls = await parseInputUrls(["--input", tempFile]);
    assert.deepEqual(urls, ["https://example.com", "https://example.org"]);
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
});
