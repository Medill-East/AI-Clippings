import test from "node:test";
import assert from "node:assert/strict";

import { makeDefaultConfig, validateConfig } from "../scripts/lib/config.js";

test("makeDefaultConfig returns a valid config shape", () => {
  const config = makeDefaultConfig();
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(config.maxConcurrentSummaries, 3);
});

test("validateConfig rejects missing required string fields", () => {
  const config = makeDefaultConfig();
  delete config.automationUserDataDir;
  assert.throws(() => validateConfig(config), /automationUserDataDir/);
});
