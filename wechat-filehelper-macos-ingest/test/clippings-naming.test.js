import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  addStableSourceSuffix,
  buildPortableClippingStem,
  choosePortableNotePath,
  ClippingNamingError,
} from "../../shared/clippings-naming.mjs";

test("buildPortableClippingStem uses the Shanghai publication date and whitelist", () => {
  assert.deepEqual(
    buildPortableClippingStem({
      title: "《九阴真经：武侠》",
      publishedAt: "2026-08-30T16:07:24.000Z",
      collectedAt: "2026-09-06T08:23:41.248Z",
    }),
    {
      date: "2026-0831",
      dateSource: "published",
      portableTitle: "九阴真经 武侠",
      stem: "2026-0831-九阴真经 武侠",
    },
  );
});

test("buildPortableClippingStem falls back explicitly and rejects missing dates", () => {
  const fallback = buildPortableClippingStem({
    title: "标题 / \\ | ? *，🧠「测试」",
    publishedAt: null,
    collectedAt: "2026-09-06T08:23:41.248Z",
  });

  assert.equal(fallback.date, "2026-0906");
  assert.equal(fallback.dateSource, "collected");
  assert.match(fallback.stem, /^[\p{L}\p{N} -]+$/u);
  assert.throws(
    () =>
      buildPortableClippingStem({
        title: "无日期",
        publishedAt: "invalid",
        collectedAt: null,
      }),
    (error) =>
      error instanceof ClippingNamingError &&
      error.code === "published_missing",
  );
});

test("choosePortableNotePath reuses the same source and suffixes conflicts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipping-name-"));
  const stem = "2026-0831-九阴真经 武侠";
  const sourceUrl = "https://weixin.qq.com/sph/Canonical1";
  const otherUrl = "https://weixin.qq.com/sph/Other2";

  try {
    const initial = await choosePortableNotePath({
      directory,
      stem,
      sourceUrl,
    });
    await fs.writeFile(
      initial.path,
      `---\nsource: "${sourceUrl}"\n---\n`,
      "utf8",
    );
    assert.deepEqual(
      await choosePortableNotePath({ directory, stem, sourceUrl }),
      { path: initial.path, reused: true, conflicted: false },
    );

    const conflict = await choosePortableNotePath({
      directory,
      stem,
      sourceUrl: otherUrl,
    });
    assert.equal(
      conflict.path,
      path.join(directory, `${addStableSourceSuffix(stem, otherUrl)}.md`),
    );
    assert.equal(conflict.conflicted, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
