import { describe, expect, it } from "vitest";
import { backoffSeconds, nextStep, parseRetryPolicy } from "../src/backoff.ts";
import type { Classification } from "../src/classify.ts";

const policy = parseRetryPolicy({});
const now = new Date("2026-10-19T12:00:00Z");
const fresh = { attemptCount: 0, createdAt: now };

function result(outcome: Classification["outcome"], extra: Partial<Classification> = {}) {
  return { outcome, errorKind: null, deadReason: null, retryAfterSeconds: null, ...extra };
}

describe("parseRetryPolicy", () => {
  it("fills in the defaults", () => {
    expect(policy).toEqual({
      base_seconds: 30,
      cap_seconds: 7200,
      max_attempts: 10,
      max_age_seconds: 259_200,
    });
    expect(parseRetryPolicy({ max_attempts: 3 }).max_attempts).toBe(3);
  });

  it("falls back to the defaults for an invalid policy", () => {
    expect(parseRetryPolicy({ max_attempts: 0 })).toEqual(policy);
    expect(parseRetryPolicy("nonsense")).toEqual(policy);
  });
});

describe("backoffSeconds", () => {
  it("doubles the ceiling with each failure, up to the cap", () => {
    const highest = () => 1;
    expect(backoffSeconds(1, policy, highest)).toBe(30);
    expect(backoffSeconds(2, policy, highest)).toBe(60);
    expect(backoffSeconds(5, policy, highest)).toBe(480);
    expect(backoffSeconds(9, policy, highest)).toBe(7200); // 30 × 2^8 = 7680, capped
    expect(backoffSeconds(1, policy, () => 0)).toBe(0);
  });

  it("spreads delays evenly between 0 and the ceiling", () => {
    // Full jitter is uniform: each tenth of the range should get about a tenth of the samples.
    // With 20,000 samples a bucket's share varies by about 0.2%, so ±1% never fails by chance.
    const samples = 20_000;
    const ceiling = 120; // failure 3: 30 × 2²
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const delay = backoffSeconds(3, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(ceiling);
      const bucket = Math.floor((delay / ceiling) * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      sum += delay;
    }
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.09);
      expect(count / samples).toBeLessThan(0.11);
    }
    expect(sum / samples).toBeGreaterThan(ceiling * 0.49);
    expect(sum / samples).toBeLessThan(ceiling * 0.51);
  });
});

describe("nextStep", () => {
  it("finishes on success and on non-retryable results", () => {
    expect(nextStep(result("success"), fresh, policy, now)).toEqual({ state: "succeeded" });
    expect(nextStep(result("non_retryable", { deadReason: "gone" }), fresh, policy, now)).toEqual({
      state: "dead",
      reason: "gone",
    });
  });

  it("schedules a failure with backoff", () => {
    const step = nextStep(result("failure"), { ...fresh, attemptCount: 2 }, policy, now, () => 0.5);
    // failure 3: ceiling 120 s, half of it
    expect(step).toEqual({ state: "pending", nextAttemptAt: new Date("2026-10-19T12:01:00Z") });
  });

  it("gives up after max attempts", () => {
    const step = nextStep(result("failure"), { ...fresh, attemptCount: 9 }, policy, now);
    expect(step).toEqual({ state: "dead", reason: "max_attempts" });
  });

  it("waits as long as Retry-After says when throttled, up to the cap", () => {
    const throttled = (retryAfterSeconds: number | null) =>
      nextStep(result("throttled", { retryAfterSeconds }), fresh, policy, now);
    expect(throttled(90)).toEqual({
      state: "pending",
      nextAttemptAt: new Date("2026-10-19T12:01:30Z"),
    });
    expect(throttled(null)).toEqual({
      state: "pending",
      nextAttemptAt: new Date("2026-10-19T12:00:30Z"),
    });
    expect(throttled(86_400)).toEqual({
      state: "pending",
      nextAttemptAt: new Date("2026-10-19T14:00:00Z"),
    });
  });

  it("never schedules a retry past max age", () => {
    // 20 s before the 72 h cutoff: even the shortest wait (30 s) would start after it
    const old = { attemptCount: 1, createdAt: new Date(now.getTime() - (72 * 3600 - 20) * 1000) };
    expect(nextStep(result("failure"), old, policy, now, () => 1)).toEqual({
      state: "dead",
      reason: "max_age",
    });
    expect(nextStep(result("throttled"), old, policy, now)).toEqual({
      state: "dead",
      reason: "max_age",
    });
  });
});
