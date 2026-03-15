function cloneForHistory(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getRetryConcurrencyPlan(initialConcurrency) {
  const plan = [];
  const firstRetryConcurrency = Math.max(1, Math.min(initialConcurrency, 2));

  plan.push(firstRetryConcurrency);
  if (firstRetryConcurrency !== 1) {
    plan.push(1);
  }

  return plan;
}

export function mergeAttemptResult(previousResult, attemptResult) {
  const snapshot = cloneForHistory(attemptResult);

  if (!previousResult) {
    return snapshot;
  }

  const attempts = previousResult.attempts
    ? cloneForHistory(previousResult.attempts)
    : [cloneForHistory({ ...previousResult, attempts: undefined })];

  attempts.push(snapshot);

  return {
    ...snapshot,
    attempts,
  };
}
