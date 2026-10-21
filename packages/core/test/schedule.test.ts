import { describe, expect, it } from "vitest";
import {
  IDLE_GAP_MS,
  nextTickAt,
  RETRY_AFTER_FAILURE_MS,
  type TickOutcome,
} from "../src/schedule.ts";

const now = Date.parse("2026-10-21T12:00:00Z");
const quiet: TickOutcome = { runAgainNow: false, claimed: 0, nextDueAt: null, failed: false };

describe("nextTickAt", () => {
  it("sleeps until woken when the queue is empty", () => {
    expect(nextTickAt(quiet, now)).toBeNull();
  });

  it("sleeps until the next delivery is due", () => {
    expect(nextTickAt({ ...quiet, claimed: 3, nextDueAt: now + 45_000 }, now)).toBe(now + 45_000);
  });

  it("runs again now when more work is waiting", () => {
    expect(nextTickAt({ ...quiet, runAgainNow: true, nextDueAt: now + 45_000 }, now)).toBe(now);
    // Rows already due after a tick that claimed some: there is more to send.
    expect(nextTickAt({ ...quiet, claimed: 10, nextDueAt: now - 5 }, now)).toBe(now - 5);
  });

  it("waits a moment when due rows couldn't be claimed", () => {
    expect(nextTickAt({ ...quiet, claimed: 0, nextDueAt: now - 5 }, now)).toBe(now + IDLE_GAP_MS);
  });

  it("retries after a failure, but never later than the next due delivery", () => {
    expect(nextTickAt({ ...quiet, failed: true }, now)).toBe(now + RETRY_AFTER_FAILURE_MS);
    expect(nextTickAt({ ...quiet, failed: true, nextDueAt: now + 3_600_000 }, now)).toBe(
      now + RETRY_AFTER_FAILURE_MS,
    );
    expect(nextTickAt({ ...quiet, failed: true, claimed: 1, nextDueAt: now + 5000 }, now)).toBe(
      now + 5000,
    );
  });
});
