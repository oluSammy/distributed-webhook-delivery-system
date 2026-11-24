import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dailyLimit } from "../apps/api/src/daily-limit.ts";
import { api } from "./api.ts";
import { connect, makeApiKey, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// The tests' DAILY_EVENT_LIMIT (tests/api.ts), lower than the real 50,000.
const LIMIT = 1000;

// A tenant that may send order.paid, and its API key.
async function sender(): Promise<{ tenant: string; key: string }> {
  const tenant = await makeTenant(sql);
  await sql`insert into event_types (tenant_id, name) values (${tenant}, 'order.paid')`;
  return { tenant, key: await makeApiKey(sql, tenant) };
}

function send(key: string, headers: Record<string, string> = {}): Promise<Response> {
  return api("/api/events", key, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "order.paid", payload: {} }),
  });
}

function sendBatch(key: string, size: number): Promise<Response> {
  const events = Array.from({ length: size }, () => ({ type: "order.paid", payload: {} }));
  return api("/api/events/batch", key, { method: "POST", body: JSON.stringify({ events }) });
}

// Sends n events in batches of up to 500 (the most a batch takes); returns the last response.
async function sendMany(key: string, n: number): Promise<Response> {
  let last: Response | undefined;
  for (let left = n; left > 0; left -= 500) {
    last = await sendBatch(key, Math.min(500, left));
    expect(last.status).toBe(202);
  }
  if (!last) {
    throw new Error("sendMany needs n > 0");
  }
  return last;
}

async function storedEvents(tenant: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from events where tenant_id = ${tenant}
    `;
  return row?.count ?? 0;
}

describe("the daily event limit", () => {
  it("accepts events up to the limit, says how many are left, then refuses with 429", async () => {
    const { key } = await sender();

    const filled = await sendMany(key, LIMIT - 2);
    expect(filled.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
    expect(filled.headers.get("RateLimit-Remaining")).toBe("2");
    expect(Number(filled.headers.get("RateLimit-Reset"))).toBeGreaterThan(0);
    expect((await send(key)).headers.get("RateLimit-Remaining")).toBe("1");
    expect((await send(key)).headers.get("RateLimit-Remaining")).toBe("0");

    const refused = await send(key);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({
      error: { code: "daily_event_limit_reached" },
    });
  });

  it("refuses a batch that would go over, whole, and stores none of it", async () => {
    const { tenant, key } = await sender();
    await sendMany(key, LIMIT - 1);

    const refused = await sendBatch(key, 3);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(
      /batch of 3 would take today's total to 1,002/,
    );
    expect(await storedEvents(tenant)).toBe(LIMIT - 1);
    // What's left still fits.
    expect((await sendBatch(key, 1)).status).toBe(202);
    expect(await storedEvents(tenant)).toBe(LIMIT);
  });

  it("doesn't count refused requests or replays of an Idempotency-Key", async () => {
    const { tenant, key } = await sender();
    const unknownType = await api("/api/events", key, {
      method: "POST",
      body: JSON.stringify({ type: "nope.nothing", payload: {} }),
    });
    expect(unknownType.status).toBe(422);

    const once = { "Idempotency-Key": "order-42" };
    const original = (await (await send(key, once)).json()) as { id: string };
    for (let i = 0; i < 3; i++) {
      const replay = await send(key, once);
      expect(replay.status).toBe(202);
      expect(((await replay.json()) as { id: string }).id).toBe(original.id);
    }
    // Only the first counted: the rest of the limit still fits, then nothing more.
    await sendMany(key, LIMIT - 1);
    expect((await send(key)).status).toBe(429);
    expect(await storedEvents(tenant)).toBe(LIMIT);
  });

  it("starts counting again on a new UTC day", async () => {
    const { tenant, key } = await sender();
    await sql`
        insert into tenant_daily_usage (tenant_id, day, events)
        values (${tenant}, (now() at time zone 'utc')::date - 1, ${LIMIT})
      `;
    expect((await send(key)).headers.get("RateLimit-Remaining")).toBe(String(LIMIT - 1));
  });

  it("lets only one of two requests at once take the last place", async () => {
    const { tenant, key } = await sender();
    await sendMany(key, LIMIT - 1);

    const statuses = (await Promise.all([send(key), send(key)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([202, 429]);
    expect(await storedEvents(tenant)).toBe(LIMIT);
  });

  it("reports today's usage", async () => {
    const { key } = await sender();
    await send(key);

    const response = await api("/api/usage", key);
    const usage = (await response.json()) as {
      events: number;
      daily_limit: number;
      resets_at: string;
    };
    expect(usage).toMatchObject({ events: 1, daily_limit: LIMIT });
    expect(usage.resets_at).toMatch(/T00:00:00\.000Z$/);
  });

  it("reads DAILY_EVENT_LIMIT: 50,000 when it isn't set; a bad value is refused", () => {
    expect(dailyLimit({})).toBe(50_000);
    expect(dailyLimit({ DAILY_EVENT_LIMIT: "500000" })).toBe(500_000);
    for (const bad of ["", "0", "-5", "5O000", "1.5"]) {
      expect(() => dailyLimit({ DAILY_EVENT_LIMIT: bad })).toThrow(/DAILY_EVENT_LIMIT/);
    }
  });
});
