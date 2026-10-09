import { hashApiKey } from "@wds/core";
import { createMiddleware } from "hono/factory";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!key) {
    throw new ApiError(401, "unauthorized", "Missing API key");
  }

  const sql = c.get("sql");
  const [row] = await sql<{ tenant_id: string }[]>`
      select tenant_id
      from api_keys
      where key_hash = ${await hashApiKey(key)}
        and revoked_at is null
        and scope = 'tenant'
    `;
  if (!row) {
    throw new ApiError(401, "unauthorized", "Invalid API key");
  }

  c.set("tenantId", row.tenant_id);
  await next();
});
