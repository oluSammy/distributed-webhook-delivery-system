import type { Sql } from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// A dead delivery in the DLQ, as the Delivery Worker leaves one: out of the queue, dead, with a
// reason. Returns its id.
async function makeDead(
  sql: Sql,
  tenantId: string,
  endpointId: string,
  reason = "max_attempts",
): Promise<string> {
  const id = await makeDelivery(sql, tenantId, endpointId);
  await sql`delete from delivery_queue where delivery_id = ${id}`;
  await sql`
      update deliveries set state = 'dead', failure_reason = ${reason}, finished_at = now()
      where id = ${id}
    `;
  return id;
}

describe("GET /api/dlq", () => {
  it("names each dead delivery's endpoint", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await sql`update endpoints set description = 'CRM sync' where id = ${endpoint}`;
    await makeDead(sql, tenant, endpoint);

    const response = await api("/api/dlq", await makeApiKey(sql, tenant));
    const { deliveries } = (await response.json()) as {
      deliveries: { endpoint_description: string; endpoint_url: string }[];
    };
    expect(deliveries).toMatchObject([
      { endpoint_description: "CRM sync", endpoint_url: "https://example.com/hook" },
    ]);
  });
});

describe("GET /api/dlq/counts", () => {
  type Counts = { total: number; reasons: { reason: string; count: number }[] };

  it("counts the tenant's dead deliveries still in the DLQ, in all and by reason", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await makeDead(sql, tenant, endpoint, "max_attempts");
    await makeDead(sql, tenant, endpoint, "max_attempts");
    await makeDead(sql, tenant, endpoint, "gone");
    const resolved = await makeDead(sql, tenant, endpoint, "gone");
    await sql`update deliveries set resolution = 'discarded', resolved_at = now() where id = ${resolved}`;
    await makeDelivery(sql, tenant, endpoint); // pending: not in the DLQ
    const other = await makeTenant(sql);
    await makeDead(sql, other, await makeEndpoint(sql, other));

    const response = await api("/api/dlq/counts", await makeApiKey(sql, tenant));
    expect((await response.json()) as Counts).toEqual({
      total: 3,
      reasons: [
        { reason: "max_attempts", count: 2 },
        { reason: "gone", count: 1 },
      ],
    });
  });

  it("follows the filters, except reason", async () => {
    const tenant = await makeTenant(sql);
    const billing = await makeEndpoint(sql, tenant);
    const crm = await makeEndpoint(sql, tenant);
    await makeDead(sql, tenant, billing, "max_attempts");
    await makeDead(sql, tenant, crm, "gone");
    const key = await makeApiKey(sql, tenant);

    const byEndpoint = await api(`/api/dlq/counts?endpoint_id=${crm}`, key);
    expect(((await byEndpoint.json()) as Counts).total).toBe(1);
    // reason isn't a filter here: every chip keeps its count while one is chosen.
    const withReason = await api("/api/dlq/counts?reason=gone", key);
    expect(((await withReason.json()) as Counts).total).toBe(2);
  });
});
