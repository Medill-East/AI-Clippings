import test from "node:test";
import assert from "node:assert/strict";

import { getRetryConcurrencyPlan, mergeAttemptResult } from "../scripts/lib/retries.js";

test("getRetryConcurrencyPlan falls back from batch retry to single retry", () => {
  assert.deepEqual(getRetryConcurrencyPlan(18), [2, 1]);
  assert.deepEqual(getRetryConcurrencyPlan(2), [2, 1]);
  assert.deepEqual(getRetryConcurrencyPlan(1), [1]);
});

test("mergeAttemptResult keeps attempt history and latest outcome", () => {
  const firstAttempt = {
    url: "https://example.com/1",
    status: "failed",
    error: "Please try reloading the page.",
    attempt: 1,
    attemptConcurrency: 18,
  };
  const secondAttempt = {
    url: "https://example.com/1",
    status: "success",
    importedNote: { filePath: "D:/Vault/example.md" },
    attempt: 2,
    attemptConcurrency: 2,
  };

  const merged = mergeAttemptResult(firstAttempt, secondAttempt);

  assert.equal(merged.status, "success");
  assert.equal(merged.attempt, 2);
  assert.equal(merged.attemptConcurrency, 2);
  assert.equal(merged.attempts.length, 2);
  assert.equal(merged.attempts[0].status, "failed");
  assert.equal(merged.attempts[1].status, "success");
});
