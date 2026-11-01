import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// A tenant with the order.paid event type registered, and its API key.
async function tenantKey(): Promise<string> {
  const tenant = await makeTenant(sql);
  await sql`insert into event_types (tenant_id, name) values (${tenant}, 'order.paid')`;
  return makeApiKey(sql, tenant);
}

function sendEvent(key: string, payload: object, idempotencyKey?: string): Promise<Response> {
  return api("/api/events", key, {
    method: "POST",
    headers: idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey },
    body: JSON.stringify({ type: "order.paid", payload }),
  });
}

async function eventCount(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from events`;
  return row?.count ?? 0;
}

describe("ingestion (POST /api/events)", () => {
  it("two requests with the same idempotency key at once make one event", async () => {
    const key = await tenantKey();
    const responses = await Promise.all([
      sendEvent(key, { order: 1 }, "same-key"),
      sendEvent(key, { order: 1 }, "same-key"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as {
      id: string;
    }[];
    expect(bodies[0]?.id).toBe(bodies[1]?.id);
    const replayed = responses.filter((response) => response.headers.has("idempotent-replayed"));
    expect(replayed).toHaveLength(1);
    expect(await eventCount()).toBe(1);
  });

  it("reusing a key with a different payload is a 422, and makes nothing", async () => {
    const key = await tenantKey();
    expect((await sendEvent(key, { order: 1 }, "reused")).status).toBe(202);

    const reused = await sendEvent(key, { order: 2 }, "reused");
    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });
    expect(await eventCount()).toBe(1);
  });

  it("an unregistered event type is a 422", async () => {
    const key = await tenantKey();
    const response = await api("/api/events", key, {
      method: "POST",
      body: JSON.stringify({ type: "order.unknown", payload: {} }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "unknown_event_type" } });
  });

  it("a wrong API key is a 401", async () => {
    await tenantKey();
    expect((await sendEvent("whk_live_wrong", { order: 1 })).status).toBe(401);
  });
});

describe("daily partitions", () => {
  it("an event goes in its UTC day's partition: just before midnight, then at midnight", async () => {
    const tenant = await makeTenant(sql);
    const rows = await sql<{ partition: string }[]>`
        with midnight as (
          select date_trunc('day', now(), 'UTC') + interval '1 day' as at
        ),
        inserted as (
          insert into events (tenant_id, type, payload, created_at)
          select ${tenant}::uuid, 'order.paid', '{}'::jsonb, at - interval '1 microsecond' from midnight
          union all
          select ${tenant}::uuid, 'order.paid', '{}'::jsonb, at from midnight
          returning tableoid::regclass::text as partition, created_at
        )
        select partition from inserted order by created_at
      `;
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    expect(rows.map((row) => row.partition)).toEqual([`events_p${day(0)}`, `events_p${day(1)}`]);
  });
});
