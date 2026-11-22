import { decryptSecret, importMasterKey } from "@wds/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, TEST_MASTER_KEY } from "./api.ts";
import { connect, makeApiKey, makeDelivery, makeEndpoint, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Endpoint = {
  id: string;
  deliveries_24h: { succeeded: number; dead: number; pending: number };
  last_delivery_at: string | null;
};

describe("GET /api/endpoints", () => {
  it("gives each endpoint its last 24 hours of deliveries by state, and its newest", async () => {
    const tenant = await makeTenant(sql);
    const busy = await makeEndpoint(sql, tenant);
    const quiet = await makeEndpoint(sql, tenant);
    for (const state of ["succeeded", "succeeded", "dead", "pending"]) {
      const id = await makeDelivery(sql, tenant, busy);
      if (state !== "pending") {
        await sql`delete from delivery_queue where delivery_id = ${id}`;
        await sql`
            update deliveries
            set state = ${state}, finished_at = now(),
                failure_reason = ${state === "dead" ? "max_attempts" : null}
            where id = ${id}
          `;
      }
    }
    const [newest] = await sql<{ created_at: Date }[]>`
        select created_at from deliveries where endpoint_id = ${busy}
        order by created_at desc limit 1
      `;

    const response = await api("/api/endpoints", await makeApiKey(sql, tenant));
    const { endpoints } = (await response.json()) as { endpoints: Endpoint[] };
    expect(endpoints.find((e) => e.id === busy)).toMatchObject({
      deliveries_24h: { succeeded: 2, dead: 1, pending: 1 },
      last_delivery_at: newest?.created_at.toISOString(),
    });
    expect(endpoints.find((e) => e.id === quiet)).toMatchObject({
      deliveries_24h: { succeeded: 0, dead: 0, pending: 0 },
      last_delivery_at: null,
    });
  });
});

describe("PATCH /api/endpoints/{id}", () => {
  async function patch(key: string, id: string, body: unknown): Promise<Response> {
    return api(`/api/endpoints/${id}`, key, { method: "PATCH", body: JSON.stringify(body) });
  }

  it("changes only the fields given, and replaces the subscriptions", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await sql`
        insert into endpoint_subscriptions (endpoint_id, event_type_pattern)
        values (${endpoint}, 'order.*'), (${endpoint}, 'invoice.paid')
      `;
    const key = await makeApiKey(sql, tenant);

    const response = await patch(key, endpoint, {
      description: "Billing service",
      rate_limit_per_s: 10,
      subscriptions: ["customer.*", "customer.*"],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "https://example.com/hook", // not given, so unchanged
      description: "Billing service",
      rate_limit_per_s: 10,
      concurrency_limit: 5,
      subscriptions: ["customer.*"],
    });
  });

  it("refuses an empty change, a bad value, and another tenant's endpoint", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const key = await makeApiKey(sql, tenant);
    expect((await patch(key, endpoint, {})).status).toBe(400);
    expect((await patch(key, endpoint, { url: "not a url" })).status).toBe(400);
    expect((await patch(key, endpoint, { subscriptions: ["Order.Paid"] })).status).toBe(400);

    const other = await makeTenant(sql);
    const theirs = await makeEndpoint(sql, other);
    expect((await patch(key, theirs, { description: "mine now" })).status).toBe(404);
  });
});

describe("POST /api/endpoints/{id}/rotate-secret", () => {
  // The endpoint's secrets that still sign, decrypted, oldest first, with when each stops.
  async function signingSecrets(endpoint: string) {
    const master = await importMasterKey(TEST_MASTER_KEY, 1);
    const rows = await sql<
      {
        secret_ciphertext: Uint8Array<ArrayBuffer>;
        secret_iv: Uint8Array<ArrayBuffer>;
        dek_ciphertext: Uint8Array<ArrayBuffer>;
        dek_iv: Uint8Array<ArrayBuffer>;
        kek_version: number;
        expires_at: Date | null;
      }[]
    >`
        select secret_ciphertext, secret_iv, dek_ciphertext, dek_iv, kek_version, expires_at
        from endpoint_secrets
        where endpoint_id = ${endpoint} and (expires_at is null or expires_at > now())
        order by created_at
      `;
    return Promise.all(
      rows.map(async (row) => ({
        secret: await decryptSecret(
          {
            secretCiphertext: row.secret_ciphertext,
            secretIv: row.secret_iv,
            dekCiphertext: row.dek_ciphertext,
            dekIv: row.dek_iv,
            kekVersion: row.kek_version,
          },
          endpoint,
          new Map([[1, master]]),
        ),
        expiresAt: row.expires_at,
      })),
    );
  }

  async function rotate(key: string, id: string) {
    const response = await api(`/api/endpoints/${id}/rotate-secret`, key, { method: "POST" });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      signing_secret: string;
      previous_expires_at: string | null;
    };
  }

  it("adds a new secret and keeps the old one signing for 24 hours", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const key = await makeApiKey(sql, tenant);
    const first = await rotate(key, endpoint); // makeEndpoint has no secret: this is its first
    expect(first.previous_expires_at).toBeNull();

    const second = await rotate(key, endpoint);
    const hours = (Date.parse(second.previous_expires_at ?? "") - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const secrets = await signingSecrets(endpoint);
    expect(secrets.map((s) => s.secret)).toEqual([first.signing_secret, second.signing_secret]);
    expect(secrets[1]?.expiresAt).toBeNull();
  });

  it("leaves an earlier rotation's expiry as it was", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    const key = await makeApiKey(sql, tenant);
    await rotate(key, endpoint);
    const second = await rotate(key, endpoint);
    await sql`
        update endpoint_secrets set expires_at = now() + interval '1 hour'
        where endpoint_id = ${endpoint} and expires_at is not null
      `;
    await rotate(key, endpoint);

    const secrets = await signingSecrets(endpoint);
    expect(secrets).toHaveLength(3);
    // The oldest keeps its hour; the second now has 24 hours; the newest none.
    const left = secrets.map((s) =>
      s.expiresAt ? (s.expiresAt.getTime() - Date.now()) / 3_600_000 : null,
    );
    expect(left[0]).toBeLessThanOrEqual(1);
    expect(left[1]).toBeGreaterThan(23.9);
    expect(left[2]).toBeNull();
    expect(secrets[1]?.secret).toBe(second.signing_secret);
  });
});

describe("POST /api/endpoints/{id}/test", () => {
  it("queues one delivery of a webhook.test event to this endpoint only", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant);
    await makeEndpoint(sql, tenant); // another endpoint: gets nothing
    const key = await makeApiKey(sql, tenant);

    const response = await api(`/api/endpoints/${endpoint}/test`, key, { method: "POST" });
    expect(response.status).toBe(202);
    const { delivery_id } = (await response.json()) as { delivery_id: string };
    const rows = await sql<{ id: string; endpoint_id: string; type: string; queued: boolean }[]>`
        select d.id, d.endpoint_id, e.type,
               exists (select 1 from delivery_queue q where q.delivery_id = d.id) as queued
        from deliveries d join events e on e.id = d.event_id
      `;
    expect(rows).toEqual([
      { id: delivery_id, endpoint_id: endpoint, type: "webhook.test", queued: true },
    ]);
    // Its deliveries are already made, so the Creator won't make others for it.
    const [event] = await sql`select 1 from events where deliveries_created_at is null`;
    expect(event).toBeUndefined();
  });

  it("refuses a paused endpoint: the test would wait unsent", async () => {
    const tenant = await makeTenant(sql);
    const endpoint = await makeEndpoint(sql, tenant, "paused");
    const key = await makeApiKey(sql, tenant);
    const response = await api(`/api/endpoints/${endpoint}/test`, key, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await sql`select 1 from deliveries`).toHaveLength(0);
  });
});
