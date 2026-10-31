import type { Classification } from "./classify.ts";

// One endpoint's limits, from its endpoints row.
export type EndpointLimits = {
  ratePerSecond: number; // rate_limit_per_s
  concurrency: number; // concurrency_limit
};

// Send now, holding a slot until it's released; or don't send before retryAt (ms since the epoch).
export type Acquired = { go: true; slotId: string } | { go: false; retryAt: number };

// What the Delivery Worker asks before each send, and tells after it. On Cloudflare it's one
// Durable Object per endpoint; elsewhere it could be backed by Redis. result is what the endpoint
// answered, or null when nothing was sent.
export interface EndpointLimiter {
  acquire(endpointId: string, limits: EndpointLimits, leaseMs: number): Promise<Acquired>;
  release(endpointId: string, slotId: string, result: Classification | null): Promise<void>;
}

// When every slot is taken, how long a delivery waits (less if a lease ends sooner). A slot usually
// frees when a send finishes, which could be any moment, so this is a guess: short enough to keep
// the endpoint's backlog moving, long enough that the delivery isn't back asking straight away.
export const SLOT_WAIT_MS = 1000;

// A throttle without Retry-After pauses the endpoint this long, doubling while throttles keep
// coming, and back to this after a success.
export const FIRST_PAUSE_MS = 5000;

// The longest one throttle pauses the endpoint, whatever Retry-After asks. Deliveries try again
// after this, so a Retry-After of a day can't silence an endpoint that has recovered.
export const MAX_PAUSE_MS = 5 * 60_000;

// A throttle halves the rate, never below this; it then climbs back this much each minute.
const MIN_RATE_PER_SECOND = 1;
const RECOVERY_PER_MINUTE = 5;

type Slot = { acquiredAt: number; leaseEndsAt: number };

// The limits for one endpoint, kept in memory. The caller passes the time (ms since the epoch), so
// tests can use a fake clock.
// - Rate: a token bucket holding up to one second's worth of sends. It refills continuously, and
//   each send takes a token.
// - Concurrency: each send holds a slot until it's released. Slots are leased, so one whose sender
//   never releases it (the Worker was stopped mid-send) frees itself when its lease ends.
// - Throttles (429, or 503 with Retry-After): the endpoint is asking for less. Every send waits
//   until the pause ends, and the rate is halved, then climbs back slowly (AIMD, as TCP does).
export class LimiterState {
  private tokens: number | null = null; // null until the first acquire, which starts it full
  private refilledAt = 0;
  private readonly slots = new Map<string, Slot>();
  private pausedUntil = 0;
  private nextPauseMs = FIRST_PAUSE_MS; // for a throttle without Retry-After
  private lastThrottleAt = Number.NEGATIVE_INFINITY;
  private cut: { rate: number; at: number } | null = null; // the rate after the last cut, and when
  private rate: number | null = null; // the rate the last acquire used

  acquire(limits: EndpointLimits, leaseMs: number, now: number): Acquired {
    if (now < this.pausedUntil) {
      return { go: false, retryAt: this.pausedUntil };
    }
    for (const [slotId, slot] of this.slots) {
      if (slot.leaseEndsAt <= now) {
        this.slots.delete(slotId);
      }
    }
    // Slots first: a delivery that can't get one mustn't use up a token.
    if (this.slots.size >= limits.concurrency) {
      const firstLeaseEnd = Math.min(...Array.from(this.slots.values(), (s) => s.leaseEndsAt));
      return { go: false, retryAt: Math.min(now + SLOT_WAIT_MS, firstLeaseEnd) };
    }

    this.rate = this.currentRate(limits, now);
    const tokens = this.refill(this.rate, now);
    if (tokens < 1) {
      const msPerToken = 1000 / this.rate;
      return { go: false, retryAt: now + Math.ceil((1 - tokens) * msPerToken) };
    }
    this.tokens = tokens - 1;
    const slotId = crypto.randomUUID();
    this.slots.set(slotId, { acquiredAt: now, leaseEndsAt: now + leaseMs });
    return { go: true, slotId };
  }

  // Frees the slot (unknown ids are ignored: the lease may have ended already) and takes note of
  // what the endpoint answered. result is null when nothing was sent.
  release(slotId: string, result: Classification | null, now: number): void {
    const slot = this.slots.get(slotId);
    this.slots.delete(slotId);
    if (result?.outcome === "success") {
      this.nextPauseMs = FIRST_PAUSE_MS;
    } else if (result?.outcome === "throttled") {
      this.throttled(result.retryAfterSeconds, slot, now);
    }
  }

  // Pauses the endpoint and halves its rate. Sends already in flight when the last throttle came
  // back went out at the old rate, so their throttles only extend the pause: five parallel 429s
  // are one signal, not five halvings.
  private throttled(retryAfterSeconds: number | null, slot: Slot | undefined, now: number): void {
    const pauseMs = retryAfterSeconds === null ? this.nextPauseMs : retryAfterSeconds * 1000;
    this.pausedUntil = Math.max(this.pausedUntil, now + Math.min(pauseMs, MAX_PAUSE_MS));

    const fresh = slot !== undefined && slot.acquiredAt > this.lastThrottleAt;
    if (!fresh) {
      return;
    }
    this.lastThrottleAt = now;
    if (retryAfterSeconds === null) {
      this.nextPauseMs = Math.min(this.nextPauseMs * 2, MAX_PAUSE_MS);
    }
    if (this.rate !== null) {
      this.cut = { rate: Math.max(MIN_RATE_PER_SECOND, this.rate / 2), at: now };
    }
  }

  // The endpoint's own limit, or less after a cut: the cut rate plus what it has recovered since.
  private currentRate(limits: EndpointLimits, now: number): number {
    if (this.cut === null) {
      return limits.ratePerSecond;
    }
    const recovered = this.cut.rate + (RECOVERY_PER_MINUTE * (now - this.cut.at)) / 60_000;
    if (recovered >= limits.ratePerSecond) {
      this.cut = null;
      return limits.ratePerSecond;
    }
    return recovered;
  }

  // Adds the tokens earned since the last refill, never more than one second's worth.
  private refill(rate: number, now: number): number {
    const elapsedSeconds = Math.max(0, now - this.refilledAt) / 1000;
    const earned = (this.tokens ?? rate) + elapsedSeconds * rate;
    this.tokens = Math.min(rate, earned);
    this.refilledAt = now;
    return this.tokens;
  }
}
