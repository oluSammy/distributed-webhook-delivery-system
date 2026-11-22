import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Page = {
  events: {
    id: string;
    type: string;
    deliveries: { total: number; succeeded: number; pending: number; dead: number };
  }[];
  next_cursor: string | null;
};

async function list(key: string, query = ""): Promise<Page> {
  const response = await api(`/api/events${query}`, key);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

// The event a delivery belongs to.
async function eventOf(deliveryId: string): Promise<string> {
  const [row] = await sql<{ event_id: string }[]>`
      select event_id from deliveries where id = ${deliveryId}
    `;
  return row?.event_id ?? "";
}

describe("GET /api/events", () => {
  it("lists the tenant's events, newest first", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const older = await eventOf(await makeDelivery(sql, tenant, endpoint));
    const newer = await eventOf(await makeDelivery(sql, tenant, endpoint));
    const other = await makeTenant(sql);
    await makeDelivery(sql, other, await makeEndpoint(sql, other));

    const { events } = await list(await makeApiKey(sql, tenant));
    expect(events.map((e) => e.id)).toEqual([newer, older]);
  });

  it("counts each event's deliveries by state", async () => {
    const tenant = await makeTenant(sql);
    const first = await makeEndpoint(sql, tenant);
    const second = await makeEndpoint(sql, tenant);
    const delivery = await makeDelivery(sql, tenant, first);
    // The same event to a second endpoint, which gave up on it.
    await sql`
        insert into deliveries
          (tenant_id, event_id, event_created_at, endpoint_id, state, failure_reason, finished_at)
        select tenant_id, event_id, event_created_at, ${second}, 'dead', 'gone', now()
        from deliveries where id = ${delivery}
      `;

    const [event] = (await list(await makeApiKey(sql, tenant))).events;
    expect(event?.deliveries).toMatchObject({ total: 2, pending: 1, dead: 1, succeeded: 0 });
  });

  it("filters by type, and pages with the cursor", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await eventOf(await makeDelivery(sql, tenant, endpoint)));
    }
    await sql`insert into events (tenant_id, type, payload) values (${tenant}, 'order.paid', '{}')`;
    const key = await makeApiKey(sql, tenant);

    const first = await list(key, "?type=test.event&limit=2");
    expect(first.events.map((e) => e.id)).toEqual([ids[2], ids[1]]);
    const second = await list(key, `?type=test.event&limit=2&cursor=${first.next_cursor}`);
    expect(second.events.map((e) => e.id)).toEqual([ids[0]]);
    expect(second.next_cursor).toBeNull();
  });
});
