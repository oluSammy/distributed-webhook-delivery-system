import type { NextStep } from "@wds/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type ClaimedDelivery, claimDeliveries } from "../apps/delivery/src/claim.ts";
import { type AttemptRecord, recordOutcome } from "../apps/delivery/src/record.ts";
import { connect, makeDelivery, makeEndpoint, makeTenant, queueRow, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

function attempt(outcome: AttemptRecord["outcome"], status: number): AttemptRecord {
  return {
    outcome,
    errorKind: outcome === "success" ? null : outcome === "throttled" ? "http_4xx" : "http_5xx",
    status,
    body: null,
    signedTimestamp: Math.floor(Date.now() / 1000),
    startedAt: new Date(),
    latencyMs: 5,
  };
}

const retryNow: NextStep = { state: "pending", nextAttemptAt: new Date() };

async function claimOne(): Promise<ClaimedDelivery> {
  const [claim] = await claimDeliveries(sql, "test");
  if (!claim) {
    throw new Error("nothing was claimed");
  }
  return claim;
}

async function deliveryRow(id: string) {
  const [row] = await sql<
    {
      state: string;
      attempt_count: number;
      throttled_count: number;
      failure_reason: string | null;
      finished: boolean;
    }[]
  >`
      select state, attempt_count, throttled_count, failure_reason, finished_at is not null as finished
      from deliveries where id = ${id}
    `;
  return row;
}

async function attempts(id: string) {
  return sql<{ attempt_number: number; outcome: string; stale: boolean }[]>`
      select attempt_number, outcome, stale from delivery_attempts
      where delivery_id = ${id} order by started_at, id
    `;
}

describe("a delivery's lifecycle (claim, then recordOutcome)", () => {
  it("a failure schedules a retry, and the next claim is attempt 2", async () => {
    const tenant = await makeTenant(sql);
    const id = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));

    const first = await claimOne();
    expect(first.attempt_number).toBe(1);
    expect(await recordOutcome(sql, first, retryNow, attempt("failure", 500))).toBe(true);
    expect(await deliveryRow(id)).toMatchObject({ state: "pending", attempt_count: 1 });
    expect(await queueRow(sql, id)).toMatchObject({ claimed: false, due: true });

    expect((await claimOne()).attempt_number).toBe(2);
  });

  it("a success finishes the delivery and takes it out of the queue", async () => {
    const tenant = await makeTenant(sql);
    const id = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));

    const claim = await claimOne();
    expect(await recordOutcome(sql, claim, { state: "succeeded" }, attempt("success", 200))).toBe(
      true,
    );
    expect(await deliveryRow(id)).toMatchObject({ state: "succeeded", finished: true });
    expect(await queueRow(sql, id)).toBeNull();
    expect(await attempts(id)).toEqual([{ attempt_number: 1, outcome: "success", stale: false }]);
  });

  it("dying records the reason", async () => {
    const tenant = await makeTenant(sql);
    const id = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));

    const step: NextStep = { state: "dead", reason: "max_attempts" };
    expect(await recordOutcome(sql, await claimOne(), step, attempt("failure", 500))).toBe(true);
    expect(await deliveryRow(id)).toMatchObject({
      state: "dead",
      failure_reason: "max_attempts",
      attempt_count: 1,
      finished: true,
    });
    expect(await queueRow(sql, id)).toBeNull();
  });

  it("a throttle counts separately and uses no attempt", async () => {
    const tenant = await makeTenant(sql);
    const id = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));

    await recordOutcome(sql, await claimOne(), retryNow, attempt("throttled", 429));
    expect(await deliveryRow(id)).toMatchObject({ attempt_count: 0, throttled_count: 1 });
    expect((await claimOne()).attempt_number).toBe(2);
  });

  it("a stale claim changes nothing, but its attempt is still recorded", async () => {
    const tenant = await makeTenant(sql);
    const id = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));

    const stalled = await claimOne();
    // Its lease runs out while it's stalled, and another call claims the delivery.
    await sql`update delivery_queue set next_attempt_at = now() where delivery_id = ${id}`;
    const current = await claimOne();
    expect(current.claim_token).not.toBe(stalled.claim_token);

    expect(await recordOutcome(sql, stalled, { state: "succeeded" }, attempt("success", 200))).toBe(
      false,
    );
    expect(await deliveryRow(id)).toMatchObject({ state: "pending", attempt_count: 0 });
    expect(await queueRow(sql, id)).toMatchObject({ claimed: true });

    const step: NextStep = { state: "dead", reason: "non_retryable" };
    expect(await recordOutcome(sql, current, step, attempt("non_retryable", 410))).toBe(true);
    expect(await deliveryRow(id)).toMatchObject({ state: "dead", failure_reason: "non_retryable" });
    expect(await attempts(id)).toEqual([
      { attempt_number: 1, outcome: "success", stale: true },
      { attempt_number: 1, outcome: "non_retryable", stale: false },
    ]);
  });
});
