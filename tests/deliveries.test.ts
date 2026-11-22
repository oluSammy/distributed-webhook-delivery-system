import { firstRow } from "@wds/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Page = {
  deliveries: {
    id: string;
    state: string;
    event_type: string | null;
    endpoint_description: string | null;
    endpoint_url: string | null;
    last_status: number | null;
    last_error_kind: string | null;
  }[];
  next_cursor: string | null;
};

async function list(key: string, query = ""): Promise<Page> {
  const response = await api(`/api/deliveries${query}`, key);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

describe("GET /api/deliveries", () => {
  it("lists all the tenant's deliveries, newest first, with no filter", async () => {
    const tenant = await makeTenant(sql);
    const billing = await makeEndpoint(sql, tenant);
    const crm = await makeEndpoint(sql, tenant);
    const first = await makeDelivery(sql, tenant, billing);
    const second = await makeDelivery(sql, tenant, crm);
    const other = await makeTenant(sql);
    await makeDelivery(sql, other, await makeEndpoint(sql, other));

    const { deliveries } = await list(await makeApiKey(sql, tenant));
    expect(deliveries.map((d) => d.id)).toEqual([second, first]);
  });

  it("names each delivery's event type and endpoint", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await sql`update endpoints set description = 'Billing service' where id = ${endpoint}`;
    await makeDelivery(sql, tenant, endpoint);

    const [delivery] = (await list(await makeApiKey(sql, tenant))).deliveries;
    expect(delivery).toMatchObject({
      event_type: "test.event",
      endpoint_description: "Billing service",
      endpoint_url: "https://example.com/hook",
    });
  });

  it("gives each delivery's last attempt that counted: its status, or its error", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const timedOut = await makeDelivery(sql, tenant, endpoint);
    const failed = await makeDelivery(sql, tenant, endpoint);
    await makeDelivery(sql, tenant, endpoint); // never tried yet
    // timedOut: a 500, then a timeout; a stale attempt after them is left out.
    await sql`
        insert into delivery_attempts
          (delivery_id, attempt_number, signed_timestamp, outcome, response_status, error_kind, stale, started_at)
        values (${timedOut}, 1, 0, 'failure', 500, null, false, now()),
               (${timedOut}, 2, 0, 'failure', null, 'timeout', false, now()),
               (${timedOut}, 3, 0, 'success', 200, null, true, now()),
               (${failed}, 1, 0, 'failure', 503, null, false, now())
      `;

    const { deliveries } = await list(await makeApiKey(sql, tenant));
    expect(deliveries.map((d) => [d.last_status, d.last_error_kind])).toEqual([
      [null, null],
      [503, null],
      [null, "timeout"],
    ]);
  });

  it("pages through them with the cursor", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await makeDelivery(sql, tenant, endpoint));
    }
    const key = await makeApiKey(sql, tenant);

    const first = await list(key, "?limit=2");
    expect(first.deliveries.map((d) => d.id)).toEqual([ids[2], ids[1]]);
    expect(first.next_cursor).not.toBeNull();
    const second = await list(key, `?limit=2&cursor=${first.next_cursor}`);
    expect(second.deliveries.map((d) => d.id)).toEqual([ids[0]]);
    expect(second.next_cursor).toBeNull();
  });

  it("filters the whole tenant by state", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await makeDelivery(sql, tenant, endpoint);
    const dead = await makeDelivery(sql, tenant, endpoint);
    await sql`delete from delivery_queue where delivery_id = ${dead}`;
    await sql`
        update deliveries set state = 'dead', failure_reason = 'max_attempts', finished_at = now()
        where id = ${dead}
      `;

    const { deliveries } = await list(await makeApiKey(sql, tenant), "?state=dead");
    expect(deliveries.map((d) => d.id)).toEqual([dead]);
  });
});

describe("GET /api/deliveries/{id}", () => {
  type Detail = {
    request_body: string | null;
    attempts: { attempt_number: number; signed_timestamp: number }[];
    other_deliveries: { id: string; endpoint_id: string }[];
  };

  it("shows the exact body it sent, and each attempt's signed timestamp", async () => {
    const tenant = await makeTenant(sql);
    const delivery = await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));
    // When the event was received, as the API reads it (a Date, so to the millisecond).
    const { received } = firstRow(
      await sql<{ received: Date }[]>`
          select e.created_at as received
          from deliveries d join events e on e.id = d.event_id
          where d.id = ${delivery}
        `,
    );
    await sql`
        insert into delivery_attempts (delivery_id, attempt_number, signed_timestamp, outcome, started_at)
        values (${delivery}, 1, 1794664851, 'failure', now())
      `;

    const response = await api(`/api/deliveries/${delivery}`, await makeApiKey(sql, tenant));
    const detail = (await response.json()) as Detail;
    const timestamp = received.toISOString();
    expect(detail.request_body).toBe(`{"type":"test.event","timestamp":"${timestamp}","data":{}}`);
    expect(detail.attempts).toMatchObject([{ attempt_number: 1, signed_timestamp: 1794664851 }]);
  });

  it("lists the same event's deliveries to its other endpoints", async () => {
    const tenant = await makeTenant(sql);
    const billing = await makeEndpoint(sql, tenant);
    const crm = await makeEndpoint(sql, tenant);
    const delivery = await makeDelivery(sql, tenant, billing);
    await makeDelivery(sql, tenant, crm); // another event: not listed
    const sibling = firstRow(
      await sql<{ id: string }[]>`
          insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id)
          select tenant_id, event_id, event_created_at, ${crm} from deliveries where id = ${delivery}
          returning id
        `,
    ).id;

    const response = await api(`/api/deliveries/${delivery}`, await makeApiKey(sql, tenant));
    const detail = (await response.json()) as Detail;
    expect(detail.other_deliveries.map((d) => [d.id, d.endpoint_id])).toEqual([[sibling, crm]]);
  });
});
