import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parkDeliveries, unparkDeliveries } from "../apps/api/src/parking.ts";
import { createDeliveries } from "../apps/creator/src/create-deliveries.ts";
import { recordBreakerChange } from "../apps/delivery/src/breaker.ts";
import { type ClaimedDelivery, claimDeliveries } from "../apps/delivery/src/claim.ts";
import { type GiveBack, releaseClaims } from "../apps/delivery/src/record.ts";
import { connect, makeDelivery, makeEndpoint, makeTenant, queueRow, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

async function endpointRow(id: string) {
  const [row] = await sql<{ state: string; probe_at: Date | null }[]>`
      select state, probe_at from endpoints where id = ${id}
    `;
  return row;
}

async function notifications(endpointId: string): Promise<string[]> {
  const rows = await sql<{ kind: string }[]>`
      select kind from notifications where endpoint_id = ${endpointId} order by created_at
    `;
  return rows.map((row) => row.kind);
}

describe("breaker changes (recordBreakerChange)", () => {
  it("a trip disables the endpoint and parks what's waiting, but not what's being sent", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const waiting = await makeDelivery(sql, tenant, endpoint);
    const sending = await makeDelivery(sql, tenant, endpoint);
    await sql`
        update delivery_queue set claim_token = gen_random_uuid(), claimed_by = 'test'
        where delivery_id = ${sending}
      `;

    const probeAt = Date.now() + 60_000;
    expect(await recordBreakerChange(sql, endpoint, { kind: "tripped", probeAt })).toBe(1);
    expect(await endpointRow(endpoint)).toEqual({ state: "disabled", probe_at: new Date(probeAt) });
    expect(await notifications(endpoint)).toEqual(["breaker_tripped"]);
    expect(await queueRow(sql, waiting)).toMatchObject({ parked: true });
    expect(await queueRow(sql, sending)).toMatchObject({ parked: false, claimed: true });
  });

  it("a close makes the endpoint active again and its parked deliveries due", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant, "disabled");
    const parked = await makeDelivery(sql, tenant, endpoint, true);

    expect(await recordBreakerChange(sql, endpoint, { kind: "closed" })).toBe(1);
    expect(await endpointRow(endpoint)).toEqual({ state: "active", probe_at: null });
    expect(await notifications(endpoint)).toEqual(["breaker_closed"]);
    expect(await queueRow(sql, parked)).toMatchObject({ parked: false, due: true });
  });

  it("leaves an endpoint that's in another state alone", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant, "paused");
    await makeDelivery(sql, tenant, endpoint);

    const change = { kind: "tripped", probeAt: Date.now() } as const;
    expect(await recordBreakerChange(sql, endpoint, change)).toBe(0);
    expect(await endpointRow(endpoint)).toMatchObject({ state: "paused" });
    expect(await notifications(endpoint)).toEqual([]);
  });
});

describe("claiming (claimDeliveries)", () => {
  it("marks a claim paused when its endpoint, its tenant or everything is paused", async () => {
    const tenantA = await makeTenant(sql);
    const pausedEndpoint = await makeEndpoint(sql, tenantA, "paused");
    const tenantB = await makeTenant(sql, true);
    const inPausedTenant = await makeEndpoint(sql, tenantB);
    const tenantC = await makeTenant(sql);
    const normal = await makeEndpoint(sql, tenantC);
    await makeDelivery(sql, tenantA, pausedEndpoint);
    await makeDelivery(sql, tenantB, inPausedTenant);
    await makeDelivery(sql, tenantC, normal);

    const pausedByEndpoint = async () => {
      const claims = await claimDeliveries(sql, "test");
      return new Map(claims.map((claim) => [claim.endpoint_id, claim.paused]));
    };
    const claimed = await pausedByEndpoint();
    expect(claimed.get(pausedEndpoint)).toBe(true);
    expect(claimed.get(inPausedTenant)).toBe(true);
    expect(claimed.get(normal)).toBe(false);

    await sql`update global_settings set paused = true`;
    await makeDelivery(sql, tenantC, normal);
    expect((await pausedByEndpoint()).get(normal)).toBe(true);
  });
});

describe("giving back unsent claims (releaseClaims)", () => {
  it("parks a claim only while Postgres still holds its endpoint", async () => {
    const tenant = await makeTenant(sql);
    const stillHeld = await makeEndpoint(sql, tenant, "disabled");
    const resumed = await makeEndpoint(sql, tenant);
    const held = await makeDelivery(sql, tenant, stillHeld);
    const released = await makeDelivery(sql, tenant, resumed);
    const claims = await claimDeliveries(sql, "test");
    expect(claims).toHaveLength(2);

    const giveBack = new Map<ClaimedDelivery, GiveBack>(
      claims.map((claim) => [claim, { dueAt: null, park: true }]),
    );
    await releaseClaims(sql, giveBack);
    expect(await queueRow(sql, held)).toMatchObject({ parked: true, claimed: false });
    expect(await queueRow(sql, released)).toMatchObject({
      parked: false,
      due: true,
      claimed: false,
    });
  });
});

describe("pause and resume (parkDeliveries, unparkDeliveries)", () => {
  it("parks an endpoint's waiting deliveries only while it's paused", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const delivery = await makeDelivery(sql, tenant, endpoint);

    expect(await parkDeliveries(sql, [endpoint])).toBe(0);
    await sql`update endpoints set state = 'paused' where id = ${endpoint}`;
    expect(await parkDeliveries(sql, [endpoint])).toBe(1);
    expect(await queueRow(sql, delivery)).toMatchObject({ parked: true });
  });

  it("un-parks only when nothing holds the endpoint any more", async () => {
    const tenant = await makeTenant(sql, true);
    const endpoint = await makeEndpoint(sql, tenant, "paused");
    const delivery = await makeDelivery(sql, tenant, endpoint, true);

    await sql`update endpoints set state = 'active' where id = ${endpoint}`;
    expect(await unparkDeliveries(sql, [endpoint])).toBe(0); // the tenant is still paused
    await sql`update tenants set paused = false where id = ${tenant}`;
    expect(await unparkDeliveries(sql, [endpoint])).toBe(1);
    expect(await queueRow(sql, delivery)).toMatchObject({ parked: false, due: true });
  });
});

describe("creating deliveries (createDeliveries)", () => {
  // Sends a new event to the endpoint and creates its delivery. Returns the delivery's queue row.
  async function newDelivery(tenantId: string, endpointId: string) {
    await sql`insert into endpoint_subscriptions (endpoint_id, event_type_pattern)
    values (${endpointId}, '*') on conflict do nothing
  `;
    await sql`insert into events (tenant_id, type, payload) values (${tenantId}, 'test.event', '{}')`;
    expect(await createDeliveries(sql)).toEqual({ events: 1, deliveries: 1 });
    const [row] = await sql<{ delivery_id: string }[]>`
    select delivery_id from delivery_queue where endpoint_id = ${endpointId}
    order by delivery_created_at desc limit 1
  `;
    return { id: row?.delivery_id ?? "", queue: await queueRow(sql, row?.delivery_id ?? "") };
  }

  it("parks a new delivery while its endpoint, tenant or everything is paused", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: false, due: true });

    await sql`update endpoints set state = 'paused' where id = ${endpoint}`;
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: true });

    await sql`update endpoints set state = 'active' where id = ${endpoint}`;
    await sql`update tenants set paused = true where id = ${tenant}`;
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: true });

    await sql`update tenants set paused = false where id = ${tenant}`;
    await sql`update global_settings set paused = true`;
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: true });
  });

  it("resuming the endpoint makes a parked new delivery due", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant, "paused");
    const { id } = await newDelivery(tenant, endpoint);

    await sql`update endpoints set state = 'active' where id = ${endpoint}`;
    expect(await unparkDeliveries(sql, [endpoint])).toBe(1);
    expect(await queueRow(sql, id)).toMatchObject({ parked: false, due: true });
  });

  it("a disabled endpoint's first new delivery is due, as its probe; later ones park", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant, "disabled");
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: false, due: true });

    await sql`update delivery_queue set next_attempt_at = 'infinity' where endpoint_id = ${endpoint}`;
    expect((await newDelivery(tenant, endpoint)).queue).toMatchObject({ parked: true });
  });
});
