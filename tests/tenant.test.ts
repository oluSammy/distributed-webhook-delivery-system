import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, asBrowser } from "./api.ts";
import { connect, makeApiKey, makeSession, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

const rename = (cookie: string, name: string) =>
  asBrowser("/api/tenant", cookie, { method: "PATCH", body: { name } });

describe("PATCH /api/tenant", () => {
  it("lets an owner rename the tenant", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);

    const response = await rename(cookie, " Acme payments ");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: tenant, name: "Acme payments" });
    const me = (await (await asBrowser("/api/me", cookie)).json()) as {
      tenants: { name: string }[];
    };
    expect(me.tenants[0]?.name).toBe("Acme payments");
  });

  it("refuses members, API keys and an empty name", async () => {
    const tenant = await makeTenant(sql);
    const owner = await makeSession(sql, tenant);
    const member = await makeSession(sql, tenant, { role: "member" });

    expect((await rename(member.cookie, "Mine now")).status).toBe(403);
    const byKey = await api("/api/tenant", await makeApiKey(sql, tenant), {
      method: "PATCH",
      body: JSON.stringify({ name: "Mine now" }),
    });
    expect(byKey.status).toBe(403);
    expect((await rename(owner.cookie, "   ")).status).toBe(400);
  });
});
