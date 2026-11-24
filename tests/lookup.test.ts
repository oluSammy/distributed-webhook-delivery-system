import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, asBrowser } from "./api.ts";
import {
  connect,
  makeApiKey,
  makeDelivery,
  makeEndpoint,
  makeSession,
  makeTenant,
  reset,
} from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

async function eventOf(deliveryId: string): Promise<string> {
  const [row] = await sql<{ event_id: string }[]>`
      select event_id from deliveries where id = ${deliveryId}
    `;
  return row?.event_id ?? "";
}

describe("GET /api/lookup/{id}", () => {
  it("says whether an id is an endpoint, a delivery or an event", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    const endpoint = await makeEndpoint(sql, tenant);
    const delivery = await makeDelivery(sql, tenant, endpoint);
    const event = await eventOf(delivery);

    for (const [id, kind] of [
      [endpoint, "endpoint"],
      [delivery, "delivery"],
      [event, "event"],
    ]) {
      const response = await api(`/api/lookup/${id}`, key);
      expect(await response.json()).toEqual({ kind, id });
    }
  });

  it("finds nothing of another tenant's, or a deleted endpoint", async () => {
    const tenant = await makeTenant(sql);
    const key = await makeApiKey(sql, tenant);
    const other = await makeTenant(sql);
    const theirs = await makeEndpoint(sql, other);
    const deleted = await makeEndpoint(sql, tenant);
    await sql`update endpoints set state = 'deleted' where id = ${deleted}`;

    expect((await api(`/api/lookup/${theirs}`, key)).status).toBe(404);
    expect((await api(`/api/lookup/${deleted}`, key)).status).toBe(404);
    expect((await api("/api/lookup/not-an-id", key)).status).toBe(400);
  });
});

describe("GET /api/me's paused", () => {
  it("says whether sending is paused for the workspace, or for everyone", async () => {
    const tenant = await makeTenant(sql, true);
    const { cookie } = await makeSession(sql, tenant);
    const me = async () =>
      ((await (await asBrowser("/api/me", cookie)).json()) as { paused: unknown }).paused;

    expect(await me()).toEqual({ workspace: true, everyone: false });
    await sql`update tenants set paused = false where id = ${tenant}`;
    await sql`update global_settings set paused = true`;
    expect(await me()).toEqual({ workspace: false, everyone: true });
  });
});
