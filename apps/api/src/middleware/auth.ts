import { hashApiKey, hashSessionToken } from "@wds/core";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Sql } from "postgres";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

// The cookie that holds a signed-in person's session token (set by the GitHub sign-in).
export const SESSION_COOKIE = "session";

// /api/* takes a tenant API key (code calling the API) or a signed-in person's session cookie (the
// dashboard). Either way the request gets a tenant: the key's, or the session's current one.
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.header("Authorization")) {
    const sql = c.get("sql");
    const [row] = await sql<{ id: string; tenant_id: string; stale: boolean }[]>`
          select id, tenant_id,
                 last_used_at is null or last_used_at < now() - interval '1 minute' as stale
          from api_keys
          where key_hash = ${await bearerKeyHash(c)}
            and revoked_at is null
            and scope = 'tenant'
        `;
    if (!row) {
      throw new ApiError(401, "unauthorized", "Invalid API key");
    }
    if (row.stale) {
      c.executionCtx.waitUntil(recordKeyUse(sql, row.id));
    }
    c.set("tenantId", row.tenant_id);
    c.set("session", null);
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    throw new ApiError(401, "unauthorized", "Missing API key or session");
  }
  const [session] = await c.get("sql")<{ id: string; user_id: string; tenant_id: string }[]>`
        select id, user_id, tenant_id
        from sessions
        where token_hash = ${await hashSessionToken(token)}
          and expires_at > now()
      `;
  if (!session) {
    throw new ApiError(401, "unauthorized", "Signed out or session expired");
  }
  if (!["GET", "HEAD"].includes(c.req.method) && !fromDashboard(c)) {
    throw new ApiError(
      403,
      "cross_site_request",
      "Changes with a session must come from the dashboard",
    );
  }
  c.set("tenantId", session.tenant_id);
  c.set("session", { id: session.id, userId: session.user_id });
  await next();
});

// Sets the key's "last used", after the response has gone. Settings shows it to the minute, so
// it's written at most once a minute per key, however many requests the key makes. A failure here
// only leaves "last used" a little old, so it's logged, not passed on.
async function recordKeyUse(sql: Sql, keyId: string): Promise<void> {
  try {
    await sql`update api_keys set last_used_at = now() where id = ${keyId}`;
  } catch (error) {
    console.error("api key: couldn't record its use", error);
  }
}

// Whether the request came from one of the dashboard's own pages. Browsers set the Origin header
// themselves on every request that can change something, and pages can't change it. SameSite=Lax
// already keeps the cookie off other sites' requests, but "site" includes every subdomain of
// olumorin.dev; this narrows it to the dashboard's exact address.
export function fromDashboard(c: Context<AppEnv>): boolean {
  return c.req.header("Origin") === new URL(c.env.DASHBOARD_URL).origin;
}

// For changes only an owner may make (API keys, the tenant's name): signed in to the dashboard,
// as an owner of the tenant it's showing. An API key can't make them, so a leaked key can't make
// itself new ones or rename the tenant.
export async function requireOwner(c: Context<AppEnv>): Promise<void> {
  const session = c.get("session");
  if (!session) {
    throw new ApiError(403, "session_required", "Only for people signed in to the dashboard");
  }
  const [row] = await c.get("sql")`
        select 1 from memberships
        where tenant_id = ${c.get("tenantId")} and user_id = ${session.userId} and role = 'owner'
      `;
  if (!row) {
    throw new ApiError(403, "owner_only", "Only the tenant's owners can do this");
  }
}

// The admin routes take only an operator key. A tenant key gets the same 401 as an unknown one.
export const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  const [row] = await c.get("sql")`
        select 1
        from api_keys
        where key_hash = ${await bearerKeyHash(c)}
          and revoked_at is null
          and scope = 'operator'
      `;
  if (!row) {
    throw new ApiError(401, "unauthorized", "Invalid operator key");
  }
  await next();
});

// GET /metrics takes an operator key, or a metrics key: one made to be handed to a monitoring service
export const requireMetricsReader = createMiddleware<AppEnv>(async (c, next) => {
  const [row] = await c.get("sql")`
        select 1
        from api_keys
        where key_hash = ${await bearerKeyHash(c)}
          and revoked_at is null
          and scope in ('operator', 'metrics')
      `;
  if (!row) {
    throw new ApiError(401, "unauthorized", "Invalid metrics key");
  }
  await next();
});

// The hash of the request's API key (Authorization: Bearer <key>), which is how keys are stored.
async function bearerKeyHash(c: Context<AppEnv>): Promise<Uint8Array> {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!key) {
    throw new ApiError(401, "unauthorized", "Missing API key");
  }
  return hashApiKey(key);
}
