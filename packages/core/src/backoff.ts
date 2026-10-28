import { z } from "zod";
import type { Classification } from "./classify.ts";

// tenants.retry_policy. Every field is optional; a missing one takes the spec's default (§8.1).
export const retryPolicySchema = z
  .object({
    base_seconds: z.int().min(10).max(3600).default(30), // 10 s – 1 h
    cap_seconds: z.int().min(60).max(21_600).default(7200), // 1 min – 6 h; default 2 h
    max_attempts: z.int().min(1).max(25).default(10),
    max_age_seconds: z.int().min(60).max(259_200).default(259_200), // 1 min – 72 h
  })
  .refine((policy) => policy.cap_seconds >= policy.base_seconds, {
    message: "cap_seconds must be at least base_seconds",
    path: ["cap_seconds"],
  });

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

const DEFAULT_POLICY = retryPolicySchema.parse({});

// The API validates a policy before storing it, so an invalid one here is a bug. Falling back to
// the defaults keeps that tenant's deliveries moving instead of failing every one of them.
export function parseRetryPolicy(stored: unknown): RetryPolicy {
  const parsed = retryPolicySchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

// Full jitter: a random delay between 0 and the exponential ceiling, so deliveries that failed
// together don't all retry together. failures counts this one, so the first retry waits up to base.
export function backoffSeconds(
  failures: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.cap_seconds, policy.base_seconds * 2 ** (failures - 1));
  return random() * ceiling;
}

export type NextStep =
  | { state: "succeeded" }
  | { state: "dead"; reason: string }
  | { state: "pending"; nextAttemptAt: Date };

export type DeliveryProgress = {
  attemptCount: number; // failures before this attempt
  throttledCount: number; // throttles before this attempt
  createdAt: Date;
};

// Decides what happens to a delivery after an attempt.
export function nextStep(
  result: Classification,
  delivery: DeliveryProgress,
  policy: RetryPolicy,
  now: Date,
  random: () => number = Math.random,
): NextStep {
  switch (result.outcome) {
    case "success":
      return { state: "succeeded" };
    case "non_retryable":
      return { state: "dead", reason: result.deadReason ?? "non_retryable" };
    case "failure": {
      const failures = delivery.attemptCount + 1;
      if (failures >= policy.max_attempts) {
        return { state: "dead", reason: "max_attempts" };
      }
      return scheduleRetry(backoffSeconds(failures, policy, random), delivery, policy, now);
    }
    case "throttled": {
      // Throttles back off like failures, counted separately. Retry-After is followed, but never
      // below base, so a Retry-After of 0 can't make a tight loop.
      const wait =
        result.retryAfterSeconds === null
          ? backoffSeconds(delivery.throttledCount + 1, policy, random)
          : Math.min(Math.max(result.retryAfterSeconds, policy.base_seconds), policy.cap_seconds);
      return scheduleRetry(wait, delivery, policy, now);
    }
  }
}

// Max age is the final cutoff: a retry that would start after it is not scheduled.
function scheduleRetry(
  seconds: number,
  delivery: DeliveryProgress,
  policy: RetryPolicy,
  now: Date,
): NextStep {
  const nextAttemptAt = new Date(now.getTime() + seconds * 1000);
  const deadline = delivery.createdAt.getTime() + policy.max_age_seconds * 1000;
  if (nextAttemptAt.getTime() > deadline) {
    return { state: "dead", reason: "max_age" };
  }
  return { state: "pending", nextAttemptAt };
}
