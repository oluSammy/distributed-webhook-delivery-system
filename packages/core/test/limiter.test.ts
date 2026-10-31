import { describe, expect, it } from "vitest";
import type { Classification } from "../src/classify.ts";
import {
  type Acquired,
  type EndpointLimits,
  FIRST_COOLDOWN_MS,
  FIRST_PAUSE_MS,
  LimiterState,
  MAX_COOLDOWN_MS,
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

// Plenty of rate and slots, so only the breaker holds sends back.
const roomy = { ratePerSecond: 1000, concurrency: 1000 };

// Sends one delivery at `now` and releases it with `result`; returns what the breaker did.
function attempt(limiter: LimiterState, result: Classification, now: number) {
  return limiter.release(slotOf(limiter.acquire(roomy, LEASE_MS, now)), result, now);
}

// Trips the breaker at `now` with 20 failures; returns the change the last one caused.
function trip(limiter: LimiterState, now = 0) {
  let change = null;
  for (let i = 0; i < 20; i++) {
    change = attempt(limiter, failure, now);
  }
  return change;
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

  it("trips once more than 90% of at least 20 attempts have failed", () => {
    const limiter = new LimiterState();
    for (let i = 0; i < 19; i++) {
      expect(attempt(limiter, failure, 0)).toBeNull();
    }
    expect(attempt(limiter, failure, 0)).toEqual({ kind: "tripped", probeAt: FIRST_COOLDOWN_MS });
    expect(limiter.acquire(roomy, LEASE_MS, 0)).toEqual({
      go: false,
      retryAt: FIRST_COOLDOWN_MS,
      park: true,
    });
  });

  it("doesn't trip at 90% failures or fewer", () => {
    const limiter = new LimiterState();
    attempt(limiter, success, 0);
    attempt(limiter, success, 0);
    for (let i = 0; i < 18; i++) {
      expect(attempt(limiter, failure, 0)).toBeNull(); // 18 of 20 is exactly 90%
    }
    expect(limiter.acquire(roomy, LEASE_MS, 0).go).toBe(true);
  });

  it("only looks at the last 50 attempts from the last 10 minutes", () => {
    const limiter = new LimiterState();
    for (let i = 0; i < 19; i++) {
      attempt(limiter, failure, 0);
    }
    // 10 minutes later the 19 have left the window, so one more failure is 1 of 1
    expect(attempt(limiter, failure, 10 * MINUTE)).toBeNull();

    const busy = new LimiterState();
    for (let i = 0; i < 6; i++) {
      attempt(busy, success, 0);
    }
    for (let i = 0; i < 44; i++) {
      expect(attempt(busy, failure, 0)).toBeNull(); // 44 of 50: 88%
    }
    // each new failure pushes out the oldest attempt; once only 4 successes are left, 46 of 50 is 92%
    expect(attempt(busy, failure, 0)).toBeNull();
    expect(attempt(busy, failure, 0)).toEqual({ kind: "tripped", probeAt: FIRST_COOLDOWN_MS });
  });

  it("ignores throttles and unsent deliveries", () => {
    const limiter = new LimiterState();
    for (let i = 0; i < 19; i++) {
      attempt(limiter, failure, 0);
    }
    expect(attempt(limiter, throttled(), 0)).toBeNull();
    expect(
      limiter.release(slotOf(limiter.acquire(roomy, LEASE_MS, 10_000)), null, 10_000),
    ).toBeNull();
    expect(attempt(limiter, failure, 10_000)).toEqual({
      kind: "tripped",
      probeAt: 10_000 + FIRST_COOLDOWN_MS,
    });
  });

  it("after the cool-down lets one probe through, and closes when it succeeds", () => {
    const limiter = new LimiterState();
    trip(limiter);
    expect(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS - 1).go).toBe(false);
    const probe = slotOf(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS));
    expect(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS)).toEqual({
      go: false,
      retryAt: FIRST_COOLDOWN_MS + LEASE_MS, // until the probe's lease ends
      park: true,
    });
    expect(limiter.release(probe, success, FIRST_COOLDOWN_MS + 200)).toEqual({ kind: "closed" });
    expect(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS + 200).go).toBe(true);
  });

  it("doubles the cool-down after each failed probe, up to 30 minutes", () => {
    const limiter = new LimiterState();
    trip(limiter);
    let now = FIRST_COOLDOWN_MS;
    const cooldowns = [];
    for (let i = 0; i < 7; i++) {
      const change = attempt(limiter, failure, now);
      if (change?.kind !== "reopened") {
        throw new Error(`expected reopened, got ${JSON.stringify(change)}`);
      }
      cooldowns.push((change.probeAt - now) / MINUTE);
      now = change.probeAt;
    }
    expect(cooldowns).toEqual([2, 4, 8, 16, 30, 30, 30]);
    expect(MAX_COOLDOWN_MS).toBe(30 * MINUTE);
  });

  it("lets another probe through when one is lost", () => {
    const limiter = new LimiterState();
    trip(limiter);
    slotOf(limiter.acquire(roomy, 5000, FIRST_COOLDOWN_MS)); // never released: its Worker stopped
    expect(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS + 4999).go).toBe(false);
    const second = slotOf(limiter.acquire(roomy, LEASE_MS, FIRST_COOLDOWN_MS + 5000));
    expect(limiter.release(second, success, FIRST_COOLDOWN_MS + 5100)).toEqual({ kind: "closed" });
  });

  it("probes straight away for an endpoint already disabled", () => {
    const limiter = new LimiterState(); // a new instance: the old one was evicted while tripped
    const disabled = { ...roomy, disabled: true };
    const probe = slotOf(limiter.acquire(disabled, LEASE_MS, 0));
    expect(limiter.acquire(disabled, LEASE_MS, 0).go).toBe(false);
    expect(limiter.release(probe, failure, 100)).toEqual({
      kind: "reopened",
      probeAt: 100 + 2 * FIRST_COOLDOWN_MS,
    });
  });

  describe("health", () => {
    it("starts at the endpoint's limits with nothing going on", () => {
      expect(new LimiterState().health(roomy, 0)).toEqual({
        ratePerSecond: 1000,
        slotsInUse: 0,
        pausedUntil: null,
        breaker: "closed",
        probeAt: null,
        recentAttempts: 0,
        recentFailures: 0,
      });
    });

    it("counts slots in use until their lease ends", () => {
      const limiter = new LimiterState();
      limiter.acquire(roomy, LEASE_MS, 0);
      limiter.acquire(roomy, LEASE_MS, 0);
      expect(limiter.health(roomy, 1000).slotsInUse).toBe(2);
      expect(limiter.health(roomy, LEASE_MS).slotsInUse).toBe(0);
    });

    it("shows a throttle's pause and the lowered rate", () => {
      const limiter = new LimiterState();
      const limits = { ratePerSecond: 50, concurrency: 100 };
      limiter.release(slotOf(limiter.acquire(limits, LEASE_MS, 0)), throttled(1), 0);
      expect(limiter.health(limits, 0)).toMatchObject({ ratePerSecond: 25, pausedUntil: 1000 });
      expect(limiter.health(limits, 1000)).toMatchObject({ pausedUntil: null });
    });

    it("counts the breaker's window, and shows when an open breaker probes", () => {
      const limiter = new LimiterState();
      attempt(limiter, success, 0);
      attempt(limiter, failure, 0);
      expect(limiter.health(roomy, 0)).toMatchObject({ recentAttempts: 2, recentFailures: 1 });
      expect(limiter.health(roomy, 10 * MINUTE)).toMatchObject({ recentAttempts: 0 });

      trip(limiter, 10 * MINUTE);
      expect(limiter.health(roomy, 10 * MINUTE)).toMatchObject({
        breaker: "open",
        probeAt: 10 * MINUTE + FIRST_COOLDOWN_MS,
      });
    });
  });
});
