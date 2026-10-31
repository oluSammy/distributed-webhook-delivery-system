import { hashApiKey } from "@wds/core";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
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
  await next();
});

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

// The hash of the request's API key (Authorization: Bearer <key>), which is how keys are stored.
async function bearerKeyHash(c: Context<AppEnv>): Promise<Uint8Array> {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!key) {
    throw new ApiError(401, "unauthorized", "Missing API key");
  }
  return hashApiKey(key);
}
