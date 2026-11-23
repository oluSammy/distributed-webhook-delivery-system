import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Stats = {
  step_seconds: number;
  events: number;
  deliveries: { succeeded: number; dead: number; pending: number };
  failing_now: number;
  dead_in_dlq: number;
  series: { at: string; succeeded: number; dead: number; pending: number }[];
};

async function stats(key: string, range = "24h"): Promise<Stats> {
  const response = await api(`/api/stats?range=${range}`, key);
  expect(response.status).toBe(200);
  return (await response.json()) as Stats;
}

// Ends a delivery the way the Delivery Worker does: out of the queue, with its final state.
async function finish(id: string, state: "succeeded" | "dead"): Promise<void> {
  await sql`delete from delivery_queue where delivery_id = ${id}`;
  await sql`
      update deliveries
      set state = ${state}, finished_at = now(),
          failure_reason = ${state === "dead" ? "max_attempts" : null}
      where id = ${id}
    `;
}

describe("GET /api/stats", () => {
  it("counts the range's events and deliveries, and what's failing or dead now", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await finish(await makeDelivery(sql, tenant, endpoint), "succeeded");
    await finish(await makeDelivery(sql, tenant, endpoint), "succeeded");
    await finish(await makeDelivery(sql, tenant, endpoint), "dead");
    const failing = await makeDelivery(sql, tenant, endpoint);
    await sql`update deliveries set attempt_count = 2 where id = ${failing}`;
    await makeDelivery(sql, tenant, endpoint); // pending, not tried yet: not failing
    const other = await makeTenant(sql);
    await makeDelivery(sql, other, await makeEndpoint(sql, other));

    const result = await stats(await makeApiKey(sql, tenant));
    expect(result).toMatchObject({
      events: 5,
      deliveries: { succeeded: 2, dead: 1, pending: 2 },
      failing_now: 1,
      dead_in_dlq: 1,
    });
  });

  it("gives every step of the chart, empty ones included, and this one's deliveries", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await finish(await makeDelivery(sql, tenant, endpoint), "succeeded");
    const key = await makeApiKey(sql, tenant);

    const hour = await stats(key, "1h");
    expect(hour.step_seconds).toBe(300);
    expect(hour.series).toHaveLength(12);
    // The one delivery is in the latest step (or the one before, if a 5-minute boundary passed
    // between making it and asking); every other step is zero.
    expect(hour.series.reduce((sum, step) => sum + step.succeeded, 0)).toBe(1);
    expect(hour.series.slice(0, -2).every((step) => step.succeeded === 0)).toBe(true);

    expect((await stats(key, "24h")).series).toHaveLength(24);
    expect((await stats(key, "7d")).series).toHaveLength(28);
  });

  it("refuses a range it doesn't offer", async () => {
    const tenant = await makeTenant(sql);
    const response = await api("/api/stats?range=1y", await makeApiKey(sql, tenant));
    expect(response.status).toBe(400);
  });
});
