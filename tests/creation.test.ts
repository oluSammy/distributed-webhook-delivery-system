import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDeliveries, EVENTS_PER_BATCH } from "../apps/creator/src/create-deliveries.ts";
import { api } from "./api.ts";
import { connect, makeApiKey, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// Stores count events for the tenant, as the API Worker does: the events, and the tenant in
// tenants_with_events. They match no endpoint, so only the picking is tested.
async function storeEvents(tenantId: string, count: number): Promise<void> {
  await sql`
      insert into events (tenant_id, type, payload)
      select ${tenantId}, 'test.event', '{}' from generate_series(1, ${count})
    `;
  await sql`insert into tenants_with_events (tenant_id) values (${tenantId}) on conflict do nothing`;
}

// How many of the tenant's events are still waiting for their deliveries to be created.
async function waiting(tenantId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
      select count(*)::int from events where tenant_id = ${tenantId} and deliveries_created_at is null
    `;
  return row?.count ?? 0;
}

async function inLine(tenantId: string): Promise<boolean> {
  const [row] = await sql`select 1 from tenants_with_events where tenant_id = ${tenantId}`;
  return row !== undefined;
}

describe("creating deliveries, fairly between tenants (createDeliveries)", () => {
  it("one tenant's backlog doesn't hold up another tenant's event", async () => {
    const busy = await makeTenant(sql);
    await storeEvents(busy, 1000);
    const quiet = await makeTenant(sql);
    await storeEvents(quiet, 1);

    expect(await createDeliveries(sql)).toMatchObject({ events: EVENTS_PER_BATCH });
    expect(await waiting(quiet)).toBe(0);
    expect(await waiting(busy)).toBe(1000 - (EVENTS_PER_BATCH - 1));
  });

  it("tenants waiting together share a batch in turns; a tenant alone gets all of it", async () => {
    const a = await makeTenant(sql);
    await storeEvents(a, 100);
    const b = await makeTenant(sql);
    await storeEvents(b, 100);

    await createDeliveries(sql);
    expect([await waiting(a), await waiting(b)]).toEqual([
      100 - EVENTS_PER_BATCH / 2,
      100 - EVENTS_PER_BATCH / 2,
    ]);

    const alone = await makeTenant(sql);
    await sql`delete from tenants_with_events where tenant_id in (${a}, ${b})`;
    await storeEvents(alone, 100);
    await createDeliveries(sql);
    expect(await waiting(alone)).toBe(100 - EVENTS_PER_BATCH);
  });

  it("a tenant leaves the line once it has no waiting events, and not before", async () => {
    const tenant = await makeTenant(sql);
    await storeEvents(tenant, EVENTS_PER_BATCH + 5);

    await createDeliveries(sql);
    expect(await inLine(tenant)).toBe(true);
    expect(await createDeliveries(sql)).toMatchObject({ events: 5 });
    expect(await inLine(tenant)).toBe(false);
  });

  it("storing an event through the API puts its tenant in line", async () => {
    const tenant = await makeTenant(sql);
    await sql`insert into event_types (tenant_id, name) values (${tenant}, 'order.paid')`;
    const key = await makeApiKey(sql, tenant);

    const single = await api("/api/events", key, {
      method: "POST",
      body: JSON.stringify({ type: "order.paid", payload: {} }),
    });
    expect(single.status).toBe(202);
    expect(await inLine(tenant)).toBe(true);

    await createDeliveries(sql);
    expect(await inLine(tenant)).toBe(false);
    const batch = await api("/api/events/batch", key, {
      method: "POST",
      body: JSON.stringify({ events: [{ type: "order.paid", payload: {} }] }),
    });
    expect(batch.status).toBe(202);
    expect(await inLine(tenant)).toBe(true);

    await createDeliveries(sql);
    const once = await api("/api/events", key, {
      method: "POST",
      headers: { "idempotency-key": "k1" },
      body: JSON.stringify({ type: "order.paid", payload: {} }),
    });
    expect(once.status).toBe(202);
    expect(await inLine(tenant)).toBe(true);
  });
});
