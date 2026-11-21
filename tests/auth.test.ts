import { firstRow, sha256 } from "@wds/core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./api.ts";
import { connect, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));
afterEach(() => vi.restoreAllMocks());

// Ada's GitHub profile, as GitHub's GET /user returns it.
const ada = {
  id: 583231,
  login: "adaokafor",
  name: "Ada Okafor",
  avatar_url: "https://a.test/ada",
};

function fakeGitHub(profile = ada) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      const { code } = JSON.parse(String(init?.body));
      return Response.json(
        code === "good" ? { access_token: "t1" } : { error: "bad_verification_code" },
      );
    }
    if (url === "https://api.github.com/user") {
      return Response.json(profile);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

async function startSignIn(next = "/deliveries"): Promise<{ cookie: string; state: string }> {
  const response = await call(`/api/auth/github?next=${encodeURIComponent(next)}`);
  const github = new URL(response.headers.get("location") ?? "");
  const cookie = (response.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
  return { cookie, state: github.searchParams.get("state") ?? "" };
}

function callback(query: string, cookie: string): Promise<Response> {
  return call(`/api/auth/github/callback?${query}`, { headers: { cookie } });
}

function sessionToken(response: Response): string | undefined {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("session="));
  return cookie?.split(";")[0]?.slice("session=".length);
}

describe("sign in with GitHub", () => {
  it("sends the browser to GitHub with the app's id, the callback and a state", async () => {
    const response = await call("/api/auth/github");
    expect(response.status).toBe(302);
    const github = new URL(response.headers.get("location") ?? "");
    expect(github.origin + github.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(github.searchParams.get("client_id")).toBe("test-client-id");
    expect(github.searchParams.get("redirect_uri")).toBe(
      "http://dashboard.test/api/auth/github/callback",
    );
    expect(github.searchParams.get("state")?.length).toBeGreaterThanOrEqual(40);
    const cookie = response.headers.getSetCookie()[0] ?? "";
    expect(cookie).toMatch(/^oauth_state=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it("a first sign-in creates the person, their own tenant as owner, and a session", async () => {
    fakeGitHub();
    const { cookie, state } = await startSignIn("/deliveries/3f9d");
    const response = await callback(`code=good&state=${state}`, cookie);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://dashboard.test/deliveries/3f9d");
    const sessionCookie = response.headers.getSetCookie().find((c) => c.startsWith("session="));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);

    const [row] = await sql<
      { login: string; tenant: string; role: string; session_tenant: string }[]
    >`
        select u.login, t.name as tenant, m.role, s.tenant_id as session_tenant
        from users u
        join memberships m on m.user_id = u.id
        join tenants t on t.id = m.tenant_id
        join sessions s on s.user_id = u.id
        where u.github_id = ${ada.id}
      `;
    expect(row).toMatchObject({
      login: "adaokafor",
      tenant: "Ada Okafor's workspace",
      role: "owner",
    });
    // The cookie holds the token; the table holds only its hash.
    const token = sessionToken(response) ?? "";
    const [stored] = await sql`select 1 from sessions where token_hash = ${await sha256(token)}`;
    expect(stored).toBeDefined();
  });

  it("a later sign-in finds the same person, even renamed, and adds no tenant", async () => {
    fakeGitHub();
    const first = await startSignIn();
    await callback(`code=good&state=${first.state}`, first.cookie);

    vi.restoreAllMocks();
    fakeGitHub({ ...ada, login: "ada", name: "Ada O." });
    const second = await startSignIn();
    await callback(`code=good&state=${second.state}`, second.cookie);

    const users = await sql<{ login: string; name: string }[]>`select login, name from users`;
    expect(users).toEqual([{ login: "ada", name: "Ada O." }]);
    const counts = firstRow(
      await sql<{ tenants: number; sessions: number }[]>`
          select (select count(*)::int from tenants) as tenants,
                 (select count(*)::int from sessions) as sessions
        `,
    );
    expect(counts).toEqual({ tenants: 1, sessions: 2 });
  });

  it("refuses a callback whose state doesn't match the browser's", async () => {
    fakeGitHub();
    const { cookie } = await startSignIn();
    const response = await callback("code=good&state=forged", cookie);
    expect(response.headers.get("location")).toBe("http://dashboard.test/sign-in?error=state");
    expect(sessionToken(response)).toBeUndefined();
    expect(await sql`select 1 from users`).toHaveLength(0);
  });

  it("refuses a callback with no state cookie (one this browser didn't start)", async () => {
    fakeGitHub();
    const { state } = await startSignIn();
    const response = await callback(`code=good&state=${state}`, "");
    expect(response.headers.get("location")).toBe("http://dashboard.test/sign-in?error=state");
  });

  it("goes back to sign-in when the person cancels on GitHub, or GitHub refuses the code", async () => {
    fakeGitHub();
    const cancelled = await startSignIn();
    const denied = await callback(`error=access_denied&state=${cancelled.state}`, cancelled.cookie);
    expect(denied.headers.get("location")).toBe("http://dashboard.test/sign-in?error=denied");

    const used = await startSignIn();
    const refused = await callback(`code=expired&state=${used.state}`, used.cookie);
    expect(refused.headers.get("location")).toBe("http://dashboard.test/sign-in?error=github");
  });

  it("only goes back to paths on the dashboard, never another site", async () => {
    fakeGitHub();
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const { cookie, state } = await startSignIn(next);
      const response = await callback(`code=good&state=${state}`, cookie);
      expect(response.headers.get("location")).toBe("http://dashboard.test/");
    }
  });
});
