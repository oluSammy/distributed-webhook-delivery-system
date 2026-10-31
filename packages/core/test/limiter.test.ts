import { describe, expect, it } from "vitest";
import type { Classification } from "../src/classify.ts";
import {
  type Acquired,
  type EndpointLimits,
  FIRST_PAUSE_MS,
  LimiterState,
  MAX_PAUSE_MS,
  SLOT_WAIT_MS,
} from "../src/limiter.ts";

const LEASE_MS = 30_000;
const MINUTE = 60_000;

const success: Classification = {
  outcome: "success",
  errorKind: null,
  deadReason: null,
  retryAfterSeconds: null,
};
const failure: Classification = { ...success, outcome: "failure", errorKind: "http_5xx" };
function throttled(retryAfterSeconds: number | null = null): Classification {
  return { ...success, outcome: "throttled", errorKind: "http_4xx", retryAfterSeconds };
}

// How many sends go through at one moment, each released straight away: the bucket's size, which
// is the current rate (rounded down) once the bucket has had a second to fill.
function burst(limiter: LimiterState, limits: EndpointLimits, now: number): number {
  let sent = 0;
  for (;;) {
    const acquired = limiter.acquire(limits, LEASE_MS, now);
    if (!acquired.go) {
      return sent;
    }
    limiter.release(acquired.slotId, success, now);
    sent++;
  }
}

// The slot from an acquire that should have said go.
function slotOf(acquired: Acquired): string {
  if (!acquired.go) {
    throw new Error(`expected go, got wait until ${acquired.retryAt}`);
  }
  return acquired.slotId;
}

describe("LimiterState", () => {
  it("lets one second's worth through at once, then spaces sends out", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 3, concurrency: 10 };
    for (let i = 0; i < 3; i++) {
      expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(true);
    }
    expect(limiter.acquire(limits, LEASE_MS, 0)).toEqual({ go: false, retryAt: 334 }); // ⅓ s, rounded up
    expect(limiter.acquire(limits, LEASE_MS, 334).go).toBe(true);
  });

  it("never stores more than one second's worth", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 2, concurrency: 10 };
    limiter.acquire(limits, LEASE_MS, 0);
    limiter.acquire(limits, LEASE_MS, 0);
    // a minute idle earns 120 tokens, but the bucket holds 2
    expect(limiter.acquire(limits, LEASE_MS, 60_000).go).toBe(true);
    expect(limiter.acquire(limits, LEASE_MS, 60_000).go).toBe(true);
    expect(limiter.acquire(limits, LEASE_MS, 60_000).go).toBe(false);
  });

  it("holds a slot per send until it's released", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 100, concurrency: 2 };
    const first = slotOf(limiter.acquire(limits, LEASE_MS, 0));
    limiter.acquire(limits, LEASE_MS, 0);
    expect(limiter.acquire(limits, LEASE_MS, 0)).toEqual({ go: false, retryAt: SLOT_WAIT_MS });
    limiter.release(first, null, 0);
    expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(true);
  });

  it("frees a slot when its lease ends", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 100, concurrency: 1 };
    const held = slotOf(limiter.acquire(limits, 5000, 0));
    expect(limiter.acquire(limits, LEASE_MS, 1000)).toEqual({ go: false, retryAt: 2000 });
    expect(limiter.acquire(limits, LEASE_MS, 4500)).toEqual({ go: false, retryAt: 5000 }); // the lease ends first
    expect(limiter.acquire(limits, LEASE_MS, 5000).go).toBe(true);
    limiter.release(held, null, 5000); // a late release of an ended lease changes nothing
    expect(limiter.acquire(limits, LEASE_MS, 5000).go).toBe(false);
  });

  it("doesn't use a token when no slot is free", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 2, concurrency: 1 };
    const first = slotOf(limiter.acquire(limits, LEASE_MS, 0));
    expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(false);
    limiter.release(first, null, 0);
    expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(true); // the second token is still there
  });

  it("follows a lowered rate straight away", () => {
    const limiter = new LimiterState();
    limiter.acquire({ ratePerSecond: 10, concurrency: 20 }, LEASE_MS, 0);
    const lowered = { ratePerSecond: 2, concurrency: 20 };
    expect(limiter.acquire(lowered, LEASE_MS, 0).go).toBe(true);
    expect(limiter.acquire(lowered, LEASE_MS, 0).go).toBe(true);
    expect(limiter.acquire(lowered, LEASE_MS, 0).go).toBe(false);
  });

  it("pauses the endpoint for Retry-After when throttled", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 50, concurrency: 5 };
    limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 0)), throttled(30), 100);
    expect(limiter.acquire(limits, LEASE_MS, 100)).toEqual({ go: false, retryAt: 30_100 });
    expect(limiter.acquire(limits, LEASE_MS, 30_099).go).toBe(false);
    expect(limiter.acquire(limits, LEASE_MS, 30_100).go).toBe(true);
  });
  it("without Retry-After, pauses 5 s, doubling while throttles continue, until a success", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 50, concurrency: 5 };
    const throttleAt = (now: number) =>
      limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, now)), throttled(), now);

    throttleAt(0);
    expect(limiter.acquire(limits, LEASE_MS, 0)).toEqual({ go: false, retryAt: FIRST_PAUSE_MS });
    throttleAt(5000);
    expect(limiter.acquire(limits, LEASE_MS, 5000)).toEqual({ go: false, retryAt: 15_000 }); // 10 s
    limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 15_000)), success, 15_000);
    throttleAt(15_000);
    expect(limiter.acquire(limits, LEASE_MS, 15_000)).toEqual({ go: false, retryAt: 20_000 }); // 5 s again
  });

  it("never pauses longer than the maximum", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 50, concurrency: 5 };
    limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 0)), throttled(86_400), 0);
    expect(limiter.acquire(limits, LEASE_MS, 0)).toEqual({ go: false, retryAt: MAX_PAUSE_MS });
  });

  it("halves the rate when throttled, then raises it 5/s each minute", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 50, concurrency: 100 };
    limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 0)), throttled(1), 0);
    expect(burst(limiter, limits, 1000)).toBe(25);
    expect(burst(limiter, limits, MINUTE)).toBe(30);
    expect(burst(limiter, limits, 2 * MINUTE)).toBe(35);
    expect(burst(limiter, limits, 10 * MINUTE)).toBe(50); // back to the endpoint's limit
  });

  it("counts throttles from sends in flight together as one", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 40, concurrency: 10 };
    const slots = [0, 1, 2].map(() => slotOf(limiter.acquire(limits, LEASE_MS, 0)));
    for (const slot of slots) {
      limiter.release(slot, throttled(1), 100);
    }
    expect(burst(limiter, limits, 1100)).toBe(20); // halved once, not three times
  });

  it("doesn't pause or slow down for failures", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 10, concurrency: 20 };
    limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 0)), failure, 0);
    expect(burst(limiter, limits, 1000)).toBe(10);
  });
});
