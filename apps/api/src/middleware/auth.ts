import { hashApiKey, hashSessionToken } from "@wds/core";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

// The cookie that holds a signed-in person's session token (set by the GitHub sign-in).
export const SESSION_COOKIE = "session";

// /api/* takes a tenant API key (code calling the API) or a signed-in person's session cookie (the
// dashboard). Either way the request gets a tenant: the key's, or the session's current one.
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.header("Authorization")) {
    const [row] = await c.get("sql")<{ tenant_id: string }[]>`
          select tenant_id
          from api_keys
          where key_hash = ${await bearerKeyHash(c)}
            and revoked_at is null
            and scope = 'tenant'
        `;
    if (!row) {
      throw new ApiError(401, "unauthorized", "Invalid API key");
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

// Whether the request came from one of the dashboard's own pages. Browsers set the Origin header
// themselves on every request that can change something, and pages can't change it. SameSite=Lax
// already keeps the cookie off other sites' requests, but "site" includes every subdomain of
// olumorin.dev; this narrows it to the dashboard's exact address.
export function fromDashboard(c: Context<AppEnv>): boolean {
  return c.req.header("Origin") === new URL(c.env.DASHBOARD_URL).origin;
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
