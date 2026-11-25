import { formatDuration } from "./format";

// GET /api/retry-policy: every field filled in, as the Delivery Worker uses it.
export type RetryPolicy = {
  base_seconds: number;
  cap_seconds: number;
  max_attempts: number;
  max_age_seconds: number;
};

// The policy in one sentence: "Up to 10 attempts within 72 h. Retries wait up to 30 s at first,
// doubling each time, to at most 2 h."
export function describePolicy(policy: RetryPolicy): string {
  if (policy.max_attempts === 1) {
    return "1 attempt: a failed delivery isn't retried.";
  }
  const wait = (seconds: number) => formatDuration(seconds * 1000);
  return `Up to ${policy.max_attempts} attempts within ${wait(policy.max_age_seconds)}. Retries wait up to ${wait(policy.base_seconds)} at first, doubling each time, to at most ${wait(policy.cap_seconds)}.`;
}

// The longest the wait before the next try can be, after this many failures. Each wait is random
// between 0 and this ceiling, which doubles with each failure up to cap_seconds: the same rule as
// backoffSeconds in packages/core, which the Delivery Worker uses. A throttled try waits what the
// endpoint asked instead (Retry-After), so this doesn't apply to it.
export function retryCeilingSeconds(policy: RetryPolicy, failures: number): number {
  return Math.min(policy.cap_seconds, policy.base_seconds * 2 ** Math.max(0, failures - 1));
}
