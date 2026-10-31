import { describe, expect, it } from "vitest";
import { type Acquired, LimiterState, SLOT_WAIT_MS } from "../src/limiter.ts";

const LEASE_MS = 30_000;

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
    limiter.release(first);
    expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(true);
  });

  it("frees a slot when its lease ends", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 100, concurrency: 1 };
    const held = slotOf(limiter.acquire(limits, 5000, 0));
    expect(limiter.acquire(limits, LEASE_MS, 1000)).toEqual({ go: false, retryAt: 2000 });
    expect(limiter.acquire(limits, LEASE_MS, 4500)).toEqual({ go: false, retryAt: 5000 }); // the lease ends first
    expect(limiter.acquire(limits, LEASE_MS, 5000).go).toBe(true);
    limiter.release(held); // a late release of an ended lease changes nothing
    expect(limiter.acquire(limits, LEASE_MS, 5000).go).toBe(false);
  });

  it("doesn't use a token when no slot is free", () => {
    const limiter = new LimiterState();
    const limits = { ratePerSecond: 2, concurrency: 1 };
    const first = slotOf(limiter.acquire(limits, LEASE_MS, 0));
    expect(limiter.acquire(limits, LEASE_MS, 0).go).toBe(false);
    limiter.release(first);
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
});
