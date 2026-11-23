import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./api.ts";
import { connect, makeApiKey, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type EventType = { name: string; endpoints: number };

const addType = (key: string, name: string) =>
  api("/api/event-types", key, { method: "POST", body: JSON.stringify({ name }) });

const sendEvent = (key: string, type: string) =>
  api("/api/events", key, { method: "POST", body: JSON.stringify({ type, payload: {} }) });

async function listTypes(key: string): Promise<EventType[]> {
  const response = await api("/api/event-types", key);
  expect(response.status).toBe(200);
  return ((await response.json()) as { event_types: EventType[] }).event_types;
}

async function subscribe(endpoint: string, pattern: string): Promise<void> {
  await sql`
      insert into endpoint_subscriptions (endpoint_id, event_type_pattern)
      values (${endpoint}, ${pattern})
    `;
}

describe("event types", () => {
  it("registers a type, from code, and events of it are accepted", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    expect((await sendEvent(key, "order.paid")).status).toBe(422);

    const response = await addType(key, "order.paid");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "order.paid", endpoints: 0 });
    expect((await sendEvent(key, "order.paid")).status).toBe(202);
    expect((await listTypes(key)).map((type) => type.name)).toEqual(["order.paid"]);
  });

  it("counts the endpoints each type reaches, by the subscription rules", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    await subscribe(await makeEndpoint(sql, tenant), "order.*");
    await subscribe(await makeEndpoint(sql, tenant, "paused"), "*");
    const deleted = await makeEndpoint(sql, tenant);
    await subscribe(deleted, "order.paid");
    await sql`update endpoints set state = 'deleted' where id = ${deleted}`;
    await addType(key, "order.paid");
    await addType(key, "invoice.sent");

    expect(await listTypes(key)).toMatchObject([
      { name: "invoice.sent", endpoints: 1 },
      { name: "order.paid", endpoints: 2 },
    ]);
  });

  it("refuses a duplicate, and a name that isn't lowercase words and dots", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    await addType(key, "order.paid");

    const again = await addType(key, "order.paid");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "event_type_exists" } });
    expect((await addType(key, "Order Paid")).status).toBe(400);
  });

  it("removes a type: new events of it are refused, other tenants' are untouched", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    await addType(key, "order.paid");
    const other = await makeApiKey(sql, await makeTenant(sql));
    await addType(other, "order.paid");

    const remove = () => api("/api/event-types/order.paid", key, { method: "DELETE" });
    expect((await remove()).status).toBe(204);
    expect((await sendEvent(key, "order.paid")).status).toBe(422);
    expect((await remove()).status).toBe(404);
    expect((await sendEvent(other, "order.paid")).status).toBe(202);
  });
});
