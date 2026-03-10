import test from "node:test";
import assert from "node:assert/strict";

import { applyEnvOverrides, makeDefaultConfig, validateConfig } from "../scripts/lib/config.js";

test("makeDefaultConfig returns a valid config shape", () => {
  const config = makeDefaultConfig();
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(config.maxConcurrentSummaries, 18);
});

test("validateConfig rejects missing required string fields", () => {
  const config = makeDefaultConfig();
  delete config.automationUserDataDir;
  assert.throws(() => validateConfig(config), /automationUserDataDir/);
});

test("applyEnvOverrides updates max concurrent summaries from env", () => {
  const previous = process.env.OBSIDIAN_CLIPPER_MAX_CONCURRENCY;
  process.env.OBSIDIAN_CLIPPER_MAX_CONCURRENCY = "8";

  try {
    const config = applyEnvOverrides(makeDefaultConfig());
    assert.equal(config.maxConcurrentSummaries, 8);
  } finally {
    if (previous === undefined) {
      delete process.env.OBSIDIAN_CLIPPER_MAX_CONCURRENCY;
    } else {
      process.env.OBSIDIAN_CLIPPER_MAX_CONCURRENCY = previous;
    }
  }
});
