import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, asBrowser } from "./api.ts";
import { connect, makeApiKey, makeSession, makeTenant, reset } from "./db.ts";

const sql = connect();
afterAll(() => sql.end());
beforeEach(() => reset(sql));

type Key = { id: string; name: string; prefix: string; last_used_at: string | null; key?: string };

async function createKey(cookie: string, name: string): Promise<Key> {
  const response = await asBrowser("/api/keys", cookie, { method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as Key;
}

async function listKeys(cookie: string): Promise<Key[]> {
  const response = await asBrowser("/api/keys", cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { keys: Key[] }).keys;
}

describe("API keys", () => {
  it("lets an owner create a key that works, shown once, then listed without it", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);

    const created = await createKey(cookie, "  Production server ");
    expect(created.name).toBe("Production server");
    expect(created.key?.startsWith(created.prefix)).toBe(true);
    expect((await api("/api/endpoints", created.key ?? "")).status).toBe(200);

    const listed = await listKeys(cookie);
    expect(listed.map((key) => key.name)).toEqual(["Production server"]);
    expect(listed[0]).not.toHaveProperty("key");
  });

  it("lists only this tenant's keys that still work, newest first", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    await createKey(cookie, "first");
    const revoked = await createKey(cookie, "revoked");
    await createKey(cookie, "second");
    await sql`update api_keys set revoked_at = now() where id = ${revoked.id}`;
    const other = await makeTenant(sql);
    await makeApiKey(sql, other);

    expect((await listKeys(cookie)).map((key) => key.name)).toEqual(["second", "first"]);
  });

  it("lets only owners, signed in, create or revoke keys", async () => {
    const tenant = await makeTenant(sql);
    const owner = await makeSession(sql, tenant);
    const member = await makeSession(sql, tenant, { role: "member" });
    const key = await createKey(owner.cookie, "ci");

    const byMember = await asBrowser("/api/keys", member.cookie, {
      method: "POST",
      body: { name: "mine" },
    });
    expect(byMember.status).toBe(403);
    expect(await byMember.json()).toMatchObject({ error: { code: "owner_only" } });
    const revokeByMember = await asBrowser(`/api/keys/${key.id}`, member.cookie, {
      method: "DELETE",
    });
    expect(revokeByMember.status).toBe(403);

    // A key can't make itself new keys.
    const byKey = await api("/api/keys", key.key ?? "", {
      method: "POST",
      body: JSON.stringify({ name: "copy" }),
    });
    expect(byKey.status).toBe(403);
    expect(await byKey.json()).toMatchObject({ error: { code: "session_required" } });
    // Members can still see the list.
    expect(await listKeys(member.cookie)).toHaveLength(1);
  });

  it("revokes a key: it stops working, and can't be revoked twice", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    const key = await createKey(cookie, "old");

    const revoke = () => asBrowser(`/api/keys/${key.id}`, cookie, { method: "DELETE" });
    expect((await revoke()).status).toBe(204);
    expect((await api("/api/endpoints", key.key ?? "")).status).toBe(401);
    expect((await revoke()).status).toBe(404);
  });

  it("doesn't revoke another tenant's key", async () => {
    const tenant = await makeTenant(sql);
    const other = await makeTenant(sql);
    const theirs = await createKey((await makeSession(sql, other)).cookie, "theirs");
    const { cookie } = await makeSession(sql, tenant);

    const response = await asBrowser(`/api/keys/${theirs.id}`, cookie, { method: "DELETE" });
    expect(response.status).toBe(404);
    expect((await api("/api/endpoints", theirs.key ?? "")).status).toBe(200);
  });

  it("records when a key was last used, at most once a minute", async () => {
    const tenant = await makeTenant(sql);
    const { cookie } = await makeSession(sql, tenant);
    const key = await createKey(cookie, "busy");
    expect(key.last_used_at).toBeNull();

    await api("/api/endpoints", key.key ?? "");
    const [first] = await listKeys(cookie);
    expect(first?.last_used_at).not.toBeNull();

    await api("/api/endpoints", key.key ?? "");
    const [second] = await listKeys(cookie);
    expect(second?.last_used_at).toBe(first?.last_used_at);
  });
});
