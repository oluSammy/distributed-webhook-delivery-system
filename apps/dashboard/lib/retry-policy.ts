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
