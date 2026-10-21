// What one dispatcher tick found, for deciding when the next tick runs.
export type TickOutcome = {
  runAgainNow: boolean; // the create batch was full, or new events arrived during the tick
  claimed: number; // deliveries claimed by all delivery calls
  nextDueAt: number | null; // earliest next_attempt_at in the queue (ms); null when the queue is empty
  failed: boolean; // a job or the next-due query failed
};

// Rows that are due but weren't claimed (another call holds them, or their tenant's turn hasn't
// come) are tried again after this gap, so the alarm never spins in a tight loop.
export const IDLE_GAP_MS = 1000;

// After a failure, try again after this long: soon enough to recover quickly, slow enough not to
// hammer a database or Worker that is down.
export const RETRY_AFTER_FAILURE_MS = 30_000;

// When the dispatcher should tick next (ms since the epoch), or null to sleep until woken.
export function nextTickAt(tick: TickOutcome, now: number): number | null {
  if (tick.runAgainNow) {
    return now;
  }
  let next = tick.nextDueAt;
  if (next !== null && next <= now && tick.claimed === 0) {
    next = now + IDLE_GAP_MS;
  }
  if (tick.failed) {
    next = Math.min(next ?? Number.POSITIVE_INFINITY, now + RETRY_AFTER_FAILURE_MS);
  }
  return next;
}
