import type { NextStep } from "@wds/core";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaimedDelivery, claimDeliveries } from "../apps/delivery/src/claim.ts";
import { type AttemptRecord, recordOutcome, releaseClaims } from "../apps/delivery/src/record.ts";
import { connect, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());

const DELIVERIES = 3;

// One step a Worker, or time, can take. Every claim ever made is kept, so a step can use an old,
// stale one, or use the same claim twice: those are the cases the claim token is for.
type Step =
  | { kind: "claim" }
  | { kind: "expire"; delivery: number } // a claim's lease runs out
  | { kind: "record"; claim: number; outcome: "retry" | "throttle" | "succeed" | "die" }
  | { kind: "release"; claim: number }; // given back unsent

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.constant({ kind: "claim" as const }),
  fc.record({ kind: fc.constant("expire" as const), delivery: fc.nat(DELIVERIES - 1) }),
  fc.record({
    kind: fc.constant("record" as const),
    claim: fc.nat(),
    outcome: fc.constantFrom("retry", "throttle", "succeed", "die"),
  }),
  fc.record({ kind: fc.constant("release" as const), claim: fc.nat() }),
);

// What should be true of one delivery, worked out without the database.
type Expected = {
  state: "pending" | "succeeded" | "dead";
  token: string | null; // the claim that may change it, if any
  expired: boolean; // that claim's lease has run out, so it can be claimed again
  failures: number;
  throttles: number;
  attempts: number; // attempt rows, stale ones included
};

const OUTCOMES: Record<
  "retry" | "throttle" | "succeed" | "die",
  { step: NextStep; outcome: AttemptRecord["outcome"] }
> = {
  retry: { step: { state: "pending", nextAttemptAt: new Date(0) }, outcome: "failure" },
  throttle: { step: { state: "pending", nextAttemptAt: new Date(0) }, outcome: "throttled" },
  succeed: { step: { state: "succeeded" }, outcome: "success" },
  die: { step: { state: "dead", reason: "max_attempts" }, outcome: "failure" },
};

function attempt(outcome: AttemptRecord["outcome"]): AttemptRecord {
  return {
    outcome,
    errorKind: null,
    status: null,
    body: null,
    signedTimestamp: 0,
    startedAt: new Date(),
    latencyMs: 1,
  };
}

async function run(steps: Step[]): Promise<void> {
  await reset(sql);
  const tenant = await makeTenant(sql);
  const endpoint = await makeEndpoint(sql, tenant);
  const ids: string[] = [];
  const expected = new Map<string, Expected>();
  for (let i = 0; i < DELIVERIES; i++) {
    const id = await makeDelivery(sql, tenant, endpoint);
    ids.push(id);
    expected.set(id, {
      state: "pending",
      token: null,
      expired: false,
      failures: 0,
      throttles: 0,
      attempts: 0,
    });
  }
  const claims: ClaimedDelivery[] = [];
  const of = (id: string) => expected.get(id) as Expected;

  for (const s of steps) {
    if (s.kind === "claim") {
      const claimable = ids.filter((id) => {
        const e = of(id);
        return e.state === "pending" && (e.token === null || e.expired);
      });
      const claimed = await claimDeliveries(sql, "test");
      expect(claimed.map((c) => c.delivery_id).sort()).toEqual(claimable.sort());
      for (const claim of claimed) {
        const e = of(claim.delivery_id);
        expect(claim.attempt_number).toBe(e.failures + e.throttles + 1);
        e.token = claim.claim_token;
        e.expired = false;
        claims.push(claim);
      }
    } else if (s.kind === "expire") {
      const id = ids[s.delivery] as string;
      await sql`
          update delivery_queue set next_attempt_at = now()
          where delivery_id = ${id} and claim_token is not null
        `;
      if (of(id).token !== null) {
        of(id).expired = true;
      }
    } else if (claims.length > 0) {
      const claim = claims[s.claim % claims.length] as ClaimedDelivery;
      const e = of(claim.delivery_id);
      const current = e.state === "pending" && e.token === claim.claim_token;
      if (s.kind === "release") {
        await releaseClaims(sql, new Map([[claim, { dueAt: null, park: false }]]));
        if (current) {
          e.token = null;
          e.expired = false;
        }
      } else {
        const { step, outcome } = OUTCOMES[s.outcome];
        expect(await recordOutcome(sql, claim, step, attempt(outcome))).toBe(current);
        e.attempts++;
        if (current) {
          e.failures += outcome === "failure" ? 1 : 0;
          e.throttles += outcome === "throttled" ? 1 : 0;
          e.state = step.state;
          e.token = null;
          e.expired = false;
        }
      }
    }

    // After every step, the database agrees with the expectation for every delivery.
    const rows = await sql<
      {
        id: string;
        state: string;
        queued: boolean;
        token: string | null;
        failures: number;
        throttles: number;
        attempts: number;
      }[]
    >`
        select d.id, d.state, q.delivery_id is not null as queued, q.claim_token as token,
               d.attempt_count as failures, d.throttled_count as throttles,
               (select count(*)::int from delivery_attempts a where a.delivery_id = d.id) as attempts
        from deliveries d
        left join delivery_queue q on q.delivery_id = d.id
      `;
    for (const { id, ...actual } of rows) {
      const e = of(id);
      expect(actual).toEqual({
        state: e.state,
        queued: e.state === "pending",
        token: e.token,
        failures: e.failures,
        throttles: e.throttles,
        attempts: e.attempts,
      });
    }
  }
}

describe("transitions", () => {
  it("under any order of claims, outcomes, lease expiries and stale or repeated writes, no transition is lost or applied twice", async () => {
    await fc.assert(fc.asyncProperty(fc.array(step, { maxLength: 25 }), run), { numRuns: 60 });
  }, 120_000);
});
