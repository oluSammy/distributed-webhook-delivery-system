import type { Classification } from "./classify.ts";

// One endpoint's limits, from its endpoints row.
export type EndpointLimits = {
  ratePerSecond: number; // rate_limit_per_s
  concurrency: number; // concurrency_limit
  disabled?: boolean; // the endpoint's breaker tripped earlier (state = 'disabled')
};

// Send now, holding a slot until it's released; or don't send before retryAt (ms since the epoch).
// park is set while the breaker is open: the delivery can wait without a time, until a probe
// succeeds, rather than coming back at retryAt to be told to wait again.
export type Acquired = { go: true; slotId: string } | { go: false; retryAt: number; park?: true };

// What a release changed about the breaker, for the Delivery Worker to record. probeAt is when the
// next test delivery may go.
export type BreakerChange = { kind: "tripped" | "reopened"; probeAt: number } | { kind: "closed" };

// What the Delivery Worker asks before each send, and tells after it. On Cloudflare it's one
// Durable Object per endpoint; elsewhere it could be backed by Redis. result is what the endpoint
// answered, or null when nothing was sent.
export interface EndpointLimiter {
  acquire(endpointId: string, limits: EndpointLimits, leaseMs: number): Promise<Acquired>;
  release(
    endpointId: string,
    slotId: string,
    result: Classification | null,
  ): Promise<BreakerChange | null>;
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

// The breaker looks at the last 50 sent attempts from the last 10 minutes (throttles left out), and
// trips when more than 90% of them failed, once there are at least 20.
const WINDOW_ATTEMPTS = 50;
const WINDOW_MS = 10 * 60_000;
const MIN_ATTEMPTS_TO_TRIP = 20;
const TRIP_FAILURE_RATE = 0.9;

// How long a tripped breaker waits before letting one test delivery through. Each failed probe
// doubles it, up to the maximum, so an endpoint that's down for a day is probed ~50 times, not 1,440.
export const FIRST_COOLDOWN_MS = 60_000;
export const MAX_COOLDOWN_MS = 30 * 60_000;

type Slot = { acquiredAt: number; leaseEndsAt: number };

// closed: sending normally. open: nothing is sent until probeAt. half_open: one probe is in flight.
type Breaker =
  | { state: "closed" }
  | { state: "open"; probeAt: number; cooldownMs: number }
  | { state: "half_open"; probeSlotId: string; cooldownMs: number };
type OpenBreaker = Exclude<Breaker, { state: "closed" }>;

// The limits for one endpoint, kept in memory. The caller passes the time (ms since the epoch), so
// tests can use a fake clock.
// - Rate: a token bucket holding up to one second's worth of sends. It refills continuously, and
//   each send takes a token.
// - Concurrency: each send holds a slot until it's released. Slots are leased, so one whose sender
//   never releases it (the Worker was stopped mid-send) frees itself when its lease ends.
// - Throttles (429, or 503 with Retry-After): the endpoint is asking for less. Every send waits
//   until the pause ends, and the rate is halved, then climbs back slowly (AIMD, as TCP does).
// - Circuit breaker: when nearly every recent attempt fails, nothing is sent until a cool-down
//   ends, and then only one probe. Its success closes the breaker; its failure starts a longer
//   cool-down.
export class LimiterState {
  private tokens: number | null = null; // null until the first acquire, which starts it full
  private refilledAt = 0;
  private readonly slots = new Map<string, Slot>();
  private pausedUntil = 0;
  private nextPauseMs = FIRST_PAUSE_MS; // for a throttle without Retry-After
  private lastThrottleAt = Number.NEGATIVE_INFINITY;
  private cut: { rate: number; at: number } | null = null; // the rate after the last cut, and when
  private rate: number | null = null; // the rate the last acquire used
  private breaker: Breaker = { state: "closed" };
  private readonly recent: { at: number; failed: boolean }[] = []; // the breaker's window, oldest first

  acquire(limits: EndpointLimits, leaseMs: number, now: number): Acquired {
    for (const [slotId, slot] of this.slots) {
      if (slot.leaseEndsAt <= now) {
        this.slots.delete(slotId);
      }
    }
    if (limits.disabled && this.breaker.state === "closed") {
      // A new instance (the old one was evicted) for an endpoint whose breaker tripped: probe now.
      this.breaker = { state: "open", probeAt: now, cooldownMs: FIRST_COOLDOWN_MS };
    }
    if (this.breaker.state !== "closed") {
      return this.acquireWhileOpen(this.breaker, leaseMs, now);
    }
    if (now < this.pausedUntil) {
      return { go: false, retryAt: this.pausedUntil };
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
    return { go: true, slotId: this.takeSlot(leaseMs, now) };
  }

  // Frees the slot (unknown ids are ignored: the lease may have ended already) and takes note of
  // what the endpoint answered (null: nothing was sent). Returns what changed about the breaker.
  release(slotId: string, result: Classification | null, now: number): BreakerChange | null {
    const slot = this.slots.get(slotId);
    this.slots.delete(slotId);
    if (this.breaker.state === "half_open" && this.breaker.probeSlotId === slotId) {
      return this.probed(result, now);
    }
    if (result === null) {
      return null;
    }
    if (result.outcome === "throttled") {
      this.throttled(result.retryAfterSeconds, slot, now);
      return null;
    }
    if (result.outcome === "success") {
      this.nextPauseMs = FIRST_PAUSE_MS;
    }
    return this.recordAttempt(result.outcome !== "success", now);
  }

  private takeSlot(leaseMs: number, now: number): string {
    const slotId = crypto.randomUUID();
    this.slots.set(slotId, { acquiredAt: now, leaseEndsAt: now + leaseMs });
    return slotId;
  }

  // Open: wait for the probe time, then send exactly one probe. Half-open: wait for the probe's
  // result.
  private acquireWhileOpen(breaker: OpenBreaker, leaseMs: number, now: number): Acquired {
    if (breaker.state === "half_open") {
      const probe = this.slots.get(breaker.probeSlotId);
      if (probe !== undefined) {
        return { go: false, retryAt: probe.leaseEndsAt, park: true };
      }
      // The probe's lease ended without an answer (its Worker stopped): send another.
    } else if (now < breaker.probeAt) {
      return { go: false, retryAt: breaker.probeAt, park: true };
    }
    const slotId = this.takeSlot(leaseMs, now);
    this.breaker = { state: "half_open", probeSlotId: slotId, cooldownMs: breaker.cooldownMs };
    return { go: true, slotId };
  }

  // Adds a sent attempt to the window, and trips the breaker if nearly all of it failed.
  private recordAttempt(failed: boolean, now: number): BreakerChange | null {
    if (this.breaker.state !== "closed") {
      return null; // sent before the breaker tripped; the probe decides what happens next
    }

    this.recent.push({ at: now, failed });
    while (
      this.recent.length > WINDOW_ATTEMPTS ||
      (this.recent[0] !== undefined && this.recent[0].at <= now - WINDOW_MS)
    ) {
      this.recent.shift();
    }
    const failures = this.recent.filter((attempt) => attempt.failed).length;
    if (
      this.recent.length < MIN_ATTEMPTS_TO_TRIP ||
      failures / this.recent.length <= TRIP_FAILURE_RATE
    ) {
      return null;
    }
    this.recent.length = 0;
    this.breaker = {
      state: "open",
      probeAt: now + FIRST_COOLDOWN_MS,
      cooldownMs: FIRST_COOLDOWN_MS,
    };
    return { kind: "tripped", probeAt: this.breaker.probeAt };
  }

  // The probe's answer. A success shows the endpoint is back, and so does a throttle: it's alive,
  // just asking for less. A failure doubles the cool-down. Nothing sent (null) tested nothing, so
  // another probe may go now.
  private probed(result: Classification | null, now: number): BreakerChange | null {
    if (this.breaker.state !== "half_open") {
      return null;
    }
    const { cooldownMs } = this.breaker;
    if (result === null) {
      this.breaker = { state: "open", probeAt: now, cooldownMs };
      return null;
    }
    if (result.outcome === "success" || result.outcome === "throttled") {
      this.breaker = { state: "closed" };
      if (result.outcome === "throttled") {
        this.throttled(result.retryAfterSeconds, undefined, now);
      }
      return { kind: "closed" };
    }
    const longer = Math.min(cooldownMs * 2, MAX_COOLDOWN_MS);
    this.breaker = { state: "open", probeAt: now + longer, cooldownMs: longer };
    return { kind: "reopened", probeAt: this.breaker.probeAt };
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
