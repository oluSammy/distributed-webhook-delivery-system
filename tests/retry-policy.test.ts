import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, asBrowser } from "./api.ts";
import { connect, makeApiKey, makeSession, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

const DEFAULTS = {
  base_seconds: 30,
  cap_seconds: 7200,
  max_attempts: 10,
  max_age_seconds: 259_200,
};

const setPolicy = (cookie: string, body: unknown) =>
  asBrowser("/api/retry-policy", cookie, { method: "PUT", body });

describe("the retry policy", () => {
  it("starts as the defaults", async () => {
    const tenant = await makeTenant(sql);
    const response = await api("/api/retry-policy", await makeApiKey(sql, tenant));
    expect(await response.json()).toEqual(DEFAULTS);
  });

  it("lets an owner change it; fields left out take their defaults", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);

    const response = await setPolicy(cookie, { max_attempts: 5, base_seconds: 60 });
    expect(response.status).toBe(200);
    const expected = { ...DEFAULTS, max_attempts: 5, base_seconds: 60 };
    expect(await response.json()).toEqual(expected);
    expect(await (await asBrowser("/api/retry-policy", cookie)).json()).toEqual(expected);
    // Stored in full, as the Delivery Worker reads it.
    const [row] = await sql<{ retry_policy: unknown }[]>`
        select retry_policy from tenants where id = ${tenant}
      `;
    expect(row?.retry_policy).toEqual(expected);
  });

  it("refuses members, API keys and a policy outside the limits", async () => {
    const tenant = await makeTenant(sql);
    const owner = await makeSession(sql, tenant);
    const member = await makeSession(sql, tenant, { role: "member" });

    expect((await setPolicy(member.cookie, { max_attempts: 1 })).status).toBe(403);
    const byKey = await api("/api/retry-policy", await makeApiKey(sql, tenant), {
      method: "PUT",
      body: JSON.stringify({ max_attempts: 1 }),
    });
    expect(byKey.status).toBe(403);
    expect((await setPolicy(owner.cookie, { max_attempts: 0 })).status).toBe(400);
    expect((await setPolicy(owner.cookie, { base_seconds: 600, cap_seconds: 300 })).status).toBe(
      400,
    );
  });
});
