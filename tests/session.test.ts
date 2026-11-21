import { firstRow } from "@wds/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, call } from "./api.ts";
import { connect, makeApiKey, makeEndpoint, makeSession, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

// The dashboard's address in the tests (DASHBOARD_URL in api.ts): a browser on its pages sends it
// as Origin.
const DASHBOARD = "http://dashboard.test";

// A request as the dashboard's browser sends it: the session cookie, and Origin on changes.
function asBrowser(
  path: string,
  cookie: string,
  {
    method = "GET",
    body,
    origin = DASHBOARD,
  }: { method?: string; body?: unknown; origin?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { cookie, "content-type": "application/json" };
  if (origin) {
    headers.origin = origin;
  }
  return call(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("the API with a session (the dashboard)", () => {
  it("reads the session's tenant, and only that tenant", async () => {
    const acme = await makeTenant(sql);
    const other = await makeTenant(sql);
    const mine = await makeEndpoint(sql, acme);
    await makeEndpoint(sql, other);
    const { cookie } = await makeSession(sql, acme);

    const response = await asBrowser("/api/endpoints", cookie);
    expect(response.status).toBe(200);
    const { endpoints } = (await response.json()) as { endpoints: { id: string }[] };
    expect(endpoints.map((e) => e.id)).toEqual([mine]);
  });

  it("refuses a missing, unknown or expired session", async () => {
    const tenant = await makeTenant(sql);
    const { cookie: expired } = await makeSession(sql, tenant, { expired: true });
    expect((await call("/api/endpoints")).status).toBe(401);
    expect((await asBrowser("/api/endpoints", "session=made-up")).status).toBe(401);
    expect((await asBrowser("/api/endpoints", expired)).status).toBe(401);
  });

  it("refuses changes that don't come from the dashboard's own pages", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    const body = { url: "https://example.com/hook", subscriptions: ["*"] };
    for (const origin of ["", "https://evil.example", "https://olumorin.dev"]) {
      const response = await asBrowser("/api/endpoints", cookie, { method: "POST", body, origin });
      expect(response.status).toBe(403);
    }
    expect(await sql`select 1 from endpoints`).toHaveLength(0);
  });

  it("still takes an API key, as before", async () => {
    const tenant = await makeTenant(sql);
    expect((await api("/api/endpoints", await makeApiKey(sql, tenant))).status).toBe(200);
  });
});

describe("GET /api/me", () => {
  it("returns the person, their tenants by name, and the one being shown", async () => {
    const acme = await makeTenant(sql);
    const { cookie, userId } = await makeSession(sql, acme);
    const globex = await makeTenant(sql);
    await sql`update tenants set name = 'Acme' where id = ${acme}`;
    await sql`update tenants set name = 'Globex' where id = ${globex}`;
    await sql`insert into memberships (tenant_id, user_id, role) values (${globex}, ${userId}, 'member')`;

    const response = await asBrowser("/api/me", cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string };
      tenant_id: string;
      tenants: { name: string; role: string }[];
    };
    expect(body.user.id).toBe(userId);
    expect(body.tenant_id).toBe(acme);
    expect(body.tenants.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "Acme", role: "owner" },
      { name: "Globex", role: "member" },
    ]);
  });

  it("isn't for API keys: there's no person behind a key", async () => {
    const tenant = await makeTenant(sql);
    const response = await api("/api/me", await makeApiKey(sql, tenant));
    expect(response.status).toBe(403);
  });
});

describe("switching tenant", () => {
  it("moves the session to another of the person's tenants", async () => {
    const acme = await makeTenant(sql);
    const globex = await makeTenant(sql);
    const { cookie, userId } = await makeSession(sql, acme);
    await sql`insert into memberships (tenant_id, user_id, role) values (${globex}, ${userId}, 'member')`;
    const globexEndpoint = await makeEndpoint(sql, globex);

    const response = await asBrowser("/api/me/tenant", cookie, {
      method: "PUT",
      body: { tenant_id: globex },
    });
    expect(response.status).toBe(200);
    const { endpoints } = (await (await asBrowser("/api/endpoints", cookie)).json()) as {
      endpoints: { id: string }[];
    };
    expect(endpoints.map((e) => e.id)).toEqual([globexEndpoint]);
  });

  it("refuses a tenant the person isn't in", async () => {
    const acme = await makeTenant(sql);
    const stranger = await makeTenant(sql);
    const { cookie, sessionId } = await makeSession(sql, acme);
    const response = await asBrowser("/api/me/tenant", cookie, {
      method: "PUT",
      body: { tenant_id: stranger },
    });
    expect(response.status).toBe(404);
    const { tenant_id } = firstRow(
      await sql<{ tenant_id: string }[]>`select tenant_id from sessions where id = ${sessionId}`,
    );
    expect(tenant_id).toBe(acme);
  });
});

describe("POST /api/auth/sign-out", () => {
  it("ends the session and clears the cookie", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    const response = await asBrowser("/api/auth/sign-out", cookie, { method: "POST" });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(/^session=;.*Max-Age=0/);
    expect(await sql`select 1 from sessions`).toHaveLength(0);
    expect((await asBrowser("/api/endpoints", cookie)).status).toBe(401);
  });

  it("refuses a sign-out from another site's page", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    const response = await asBrowser("/api/auth/sign-out", cookie, {
      method: "POST",
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
    expect(await sql`select 1 from sessions`).toHaveLength(1);
  });
});
