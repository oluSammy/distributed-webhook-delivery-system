// One endpoint's limits, from its endpoints row.
export type EndpointLimits = {
  ratePerSecond: number; // rate_limit_per_s
  concurrency: number; // concurrency_limit
};

// Send now, holding a slot until it's released; or don't send before retryAt (ms since the epoch).
export type Acquired = { go: true; slotId: string } | { go: false; retryAt: number };

// When every slot is taken, how long a delivery waits (less if a lease ends sooner). A slot usually
// frees when a send finishes, which could be any moment, so this is a guess: short enough to keep
// the endpoint's backlog moving, long enough that the delivery isn't back asking straight away.
export const SLOT_WAIT_MS = 1000;

// The rate and concurrency limits for one endpoint, kept in memory. The caller passes the time
// (ms since the epoch), so tests can use a fake clock.
// - Rate: a token bucket holding up to one second's worth of sends. It refills continuously, and
//   each send takes a token.
// - Concurrency: each send holds a slot until it's released. Slots are leased, so one whose sender
//   never releases it (the Worker was stopped mid-send) frees itself when its lease ends.
export class LimiterState {
  private tokens: number | null = null; // null until the first acquire, which starts it full
  private refilledAt = 0;
  private readonly slots = new Map<string, number>(); // slot id → when its lease ends

  acquire(limits: EndpointLimits, leaseMs: number, now: number): Acquired {
    for (const [slotId, leaseEndsAt] of this.slots) {
      if (leaseEndsAt <= now) {
        this.slots.delete(slotId);
      }
    }
    // Slots first: a delivery that can't get one mustn't use up a token.
    if (this.slots.size >= limits.concurrency) {
      const firstLeaseEnd = Math.min(...this.slots.values());
      return { go: false, retryAt: Math.min(now + SLOT_WAIT_MS, firstLeaseEnd) };
    }

    const tokens = this.refill(limits, now);
    if (tokens < 1) {
      const msPerToken = 1000 / limits.ratePerSecond;
      return { go: false, retryAt: now + Math.ceil((1 - tokens) * msPerToken) };
    }
    this.tokens = tokens - 1;
    const slotId = crypto.randomUUID();
    this.slots.set(slotId, now + leaseMs);
    return { go: true, slotId };
  }

  // Unknown ids are ignored: the lease may have ended already.
  release(slotId: string): void {
    this.slots.delete(slotId);
  }

  // Adds the tokens earned since the last refill, never more than one second's worth.
  private refill(limits: EndpointLimits, now: number): number {
    const elapsedSeconds = Math.max(0, now - this.refilledAt) / 1000;
    const earned = (this.tokens ?? limits.ratePerSecond) + elapsedSeconds * limits.ratePerSecond;
    this.tokens = Math.min(limits.ratePerSecond, earned);
    this.refilledAt = now;
    return this.tokens;
  }
}
