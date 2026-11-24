import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Onboarding = {
  steps: { event_type: boolean; endpoint: boolean; delivered: boolean; event_sent: boolean };
  event_type: string | null;
  endpoint_id: string | null;
};

async function onboarding(key: string): Promise<Onboarding> {
  const response = await api("/api/onboarding", key);
  expect(response.status).toBe(200);
  return (await response.json()) as Onboarding;
}

describe("GET /api/onboarding", () => {
  it("has nothing done for a new tenant", async () => {
    const tenant = await makeTenant(sql);
    expect(await onboarding(await makeApiKey(sql, tenant))).toEqual({
      steps: { event_type: false, endpoint: false, delivered: false, event_sent: false },
      event_type: null,
      endpoint_id: null,
    });
  });

  it("marks each step done from the tenant's own data", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    await sql`insert into event_types (tenant_id, name) values (${tenant}, 'order.paid')`;
    const endpoint = await makeEndpoint(sql, tenant);
    const delivery = await makeDelivery(sql, tenant, endpoint); // a test.event, still pending

    let result = await onboarding(key);
    expect(result).toMatchObject({
      steps: { event_type: true, endpoint: true, delivered: false, event_sent: true },
      event_type: "order.paid",
      endpoint_id: endpoint,
    });

    await sql`update deliveries set state = 'succeeded', finished_at = now() where id = ${delivery}`;
    result = await onboarding(key);
    expect(result.steps.delivered).toBe(true);
  });

  it("doesn't count a test event as the tenant's code sending one, or a deleted endpoint", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    const endpoint = await makeEndpoint(sql, tenant);
    await sql`insert into events (tenant_id, type, payload) values (${tenant}, 'webhook.test', '{}')`;
    await sql`update endpoints set state = 'deleted' where id = ${endpoint}`;
    const other = await makeTenant(sql);
    await sql`insert into events (tenant_id, type, payload) values (${other}, 'order.paid', '{}')`;

    expect((await onboarding(key)).steps).toMatchObject({ endpoint: false, event_sent: false });
  });
});
