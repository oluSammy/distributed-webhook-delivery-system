import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import {
  connect,
  makeApiKey,
  makeDelivery,
  makeEndpoint,
  makeMetricsKey,
  makeOperatorKey,
  makeTenant,
  reset,
} from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// GET /metrics as a map from each sample (name and labels, as printed) to its value.
async function metrics(key: string): Promise<Map<string, number>> {
  const response = await api("/metrics", key);
  expect(response.status).toBe(200);
  const samples = new Map<string, number>();
  for (const line of (await response.text()).split("\n")) {
    const [series, value] = line.split(" ");
    if (series && value && !line.startsWith("#")) {
      samples.set(series, Number(value));
    }
  }
  return samples;
}

describe("metrics (GET /metrics)", () => {
  it("a tenant key can't read them", async () => {
    const tenant = await makeTenant(sql);
    expect((await api("/metrics", await makeApiKey(sql, tenant))).status).toBe(401);
  });

  it("a metrics key reads them, and nothing else", async () => {
    const key = await makeMetricsKey(sql);
    expect((await api("/metrics", key)).status).toBe(200);
    expect((await api("/admin/pause", key, { method: "POST" })).status).toBe(401);
    expect((await api("/api/endpoints", key)).status).toBe(401);
  });

  it("counts the queue by status, the DLQ, endpoints, recent attempts and pauses", async () => {
    const tenant = await makeTenant(sql, true);
    const endpoint = await makeEndpoint(sql, tenant);
    await makeEndpoint(sql, tenant, "disabled");
    await makeDelivery(sql, tenant, endpoint); // due
    await makeDelivery(sql, tenant, endpoint, true); // parked
    const claimed = await makeDelivery(sql, tenant, endpoint);
    const stale = await makeDelivery(sql, tenant, endpoint);
    await sql`
        update delivery_queue set claim_token = gen_random_uuid(), claimed_by = 'test',
          next_attempt_at = case when delivery_id = ${claimed} then now() + interval '90 seconds'
                                 else now() - interval '1 second' end
        where delivery_id in (${claimed}, ${stale})
      `;
    // One dead delivery still in the DLQ: two failed attempts in the last minute, and a successful
    // one 10 minutes ago (as if from an earlier delivery), outside the 5-minute window.
    const dead = await makeDelivery(sql, tenant, endpoint);
    await sql`delete from delivery_queue where delivery_id = ${dead}`;
    await sql`
        update deliveries set state = 'dead', failure_reason = 'max_attempts', finished_at = now()
        where id = ${dead}
      `;
    await sql`
        insert into delivery_attempts (delivery_id, attempt_number, signed_timestamp, outcome, started_at)
        values (${dead}, 1, 0, 'failure', now() - interval '1 minute'),
               (${dead}, 2, 0, 'failure', now()),
               (${dead}, 1, 0, 'success', now() - interval '10 minutes')
      `;
    // An event waiting for its deliveries to be created.
    await sql`insert into events (tenant_id, type, payload) values (${tenant}, 'test.event', '{}')`;

    const m = await metrics(await makeOperatorKey(sql));
    expect(m.get('webhook_queue_deliveries{status="due"}')).toBe(1);
    expect(m.get('webhook_queue_deliveries{status="parked"}')).toBe(1);
    expect(m.get('webhook_queue_deliveries{status="claimed"}')).toBe(1);
    expect(m.get('webhook_queue_deliveries{status="stale"}')).toBe(1);
    expect(m.get('webhook_queue_deliveries{status="scheduled"}')).toBe(0);
    expect(m.get("webhook_queue_oldest_due_seconds")).toBeGreaterThanOrEqual(0);
    expect(m.get("webhook_events_waiting")).toBe(1);
    expect(m.get("webhook_dlq_deliveries")).toBe(1);
    expect(m.get('webhook_endpoints{state="active"}')).toBe(1);
    expect(m.get('webhook_endpoints{state="disabled"}')).toBe(1);
    // The success 10 minutes ago is outside the 5-minute window.
    expect(m.get('webhook_attempts_5m{outcome="failure"}')).toBe(2);
    expect(m.get('webhook_attempts_5m{outcome="success"}')).toBe(0);
    expect(m.get("webhook_tenants_paused")).toBe(1);
    expect(m.get("webhook_paused")).toBe(0);
  });

  it("has no label value that names a tenant, endpoint or delivery", async () => {
    const tenant = await makeTenant(sql);
    await makeDelivery(sql, tenant, await makeEndpoint(sql, tenant));
    const response = await api("/metrics", await makeOperatorKey(sql));
    expect(await response.text()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
