import test from "node:test";
import assert from "node:assert/strict";

import { chooseVaultCandidate, normalizeNoteStem } from "../scripts/lib/obsidian.js";

test("normalizeNoteStem normalizes Windows-illegal characters and spacing", () => {
  assert.equal(
    normalizeNoteStem('2026-0307-234221-万字解析 | 从 OpenClaw 出发，重新理解 AI产品'),
    "2026-0307-234221-万字解析 从 openclaw 出发,重新理解 ai产品",
  );
});

test("chooseVaultCandidate prefers the open vault among matching names", () => {
  const selected = chooseVaultCandidate(
    [
      { name: "PlayWithExperiences", open: false, path: "D:/A/PlayWithExperiences", ts: 1 },
      { name: "PlayWithExperiences", open: true, path: "D:/B/PlayWithExperiences", ts: 2 },
      { name: "Other", open: true, path: "D:/Other", ts: 3 },
    ],
    ["PlayWithExperiences"],
  );

  assert.equal(selected?.path, "D:/B/PlayWithExperiences");
});
