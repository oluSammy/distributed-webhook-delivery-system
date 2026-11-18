import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findNextDue } from "../apps/dispatcher/src/next-due.ts";
import { connect, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// Moves the delivery's queue row to the given time ('infinity' parks it).
async function dueAt(deliveryId: string, at: Date | "infinity"): Promise<void> {
  const time = at === "infinity" ? sql`'infinity'` : sql`${at}`;
  await sql`update delivery_queue set next_attempt_at = ${time} where delivery_id = ${deliveryId}`;
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000);

describe("when the Dispatcher's next tick is needed (findNextDue)", () => {
  it("is null when nothing is queued and nothing will be probed", async () => {
    expect(await findNextDue(sql)).toBeNull();
  });

  it("is the earliest due row of any tenant; parked rows don't count", async () => {
    const a = await makeTenant(sql);
    const aEndpoint = await makeEndpoint(sql, a);
    await dueAt(await makeDelivery(sql, a, aEndpoint), inSeconds(60));
    await dueAt(await makeDelivery(sql, a, aEndpoint), "infinity");
    const b = await makeTenant(sql);
    await dueAt(await makeDelivery(sql, b, await makeEndpoint(sql, b)), inSeconds(30));

    const next = await findNextDue(sql);
    expect(next?.getTime()).toBeCloseTo(inSeconds(30).getTime(), -3);
  });

  it("counts a claimed row at the end of its lease, and a disabled endpoint's probe time", async () => {
    const tenant = await makeTenant(sql);
    const delivery = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));
    await sql`
          update delivery_queue
          set next_attempt_at = ${inSeconds(90)}, claim_token = gen_random_uuid(), claimed_by = 'test'
          where delivery_id = ${delivery}
        `;
    expect((await findNextDue(sql))?.getTime()).toBeCloseTo(inSeconds(90).getTime(), -3);

    // makeEndpoint sets a disabled endpoint's probe time a minute ahead, before the lease ends.
    await makeEndpoint(sql, tenant, "disabled");
    expect((await findNextDue(sql))?.getTime()).toBeCloseTo(inSeconds(60).getTime(), -3);
  });
});

describe("delivery_queue's indexes", () => {
  // An index led by next_attempt_at lets Postgres answer the claim's "this tenant's due rows,
  // oldest first" by walking the whole queue in time order, and with one tenant owning most of it,
  // its statistics make that look cheapest: 631 ms per claim with 1,000,000 rows (migration 0015).
  it("has none that starts with next_attempt_at", async () => {
    const indexes = await sql<{ name: string; first: string }[]>`
          select i.relname as name, a.attname as first
          from pg_index x
          join pg_class i on i.oid = x.indexrelid
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
          where x.indrelid = 'delivery_queue'::regclass
        `;
    expect(indexes.filter((index) => index.first === "next_attempt_at")).toEqual([]);
  });
});
