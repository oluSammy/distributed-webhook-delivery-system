import { createRoute, z } from "@hono/zod-openapi";
import type { Sql } from "postgres";
import { wakeDispatcher } from "../dispatcher";
import { ApiError } from "../errors";
import { moveInBatches, parkDeliveries, unparkDeliveries } from "../parking";
import { createRouter } from "../router";

const TenantParams = z.object({ id: z.uuid() });

// What a pause or resume did: the flag now, and how many deliveries were parked (pause) or made
// due (resume).
const PauseResult = z.object({ paused: z.boolean(), deliveries_moved: z.number() });

const pauseResponses = {
  200: {
    description: "The pause flag is set, and the deliveries it holds are parked or let go",
    content: { "application/json": { schema: PauseResult } },
  },
};

const pauseAll = createRoute({ method: "post", path: "/pause", responses: pauseResponses });
const resumeAll = createRoute({ method: "post", path: "/resume", responses: pauseResponses });
const pauseTenant = createRoute({
  method: "post",
  path: "/tenants/{id}/pause",
  request: { params: TenantParams },
  responses: pauseResponses,
});
const resumeTenant = createRoute({
  method: "post",
  path: "/tenants/{id}/resume",
  request: { params: TenantParams },
  responses: pauseResponses,
});

export const admin = createRouter();

// Pausing everything is for deploy safety: no delivery is sent until it's resumed. Like the
// endpoint routes, the flag is set first, then the parking runs, also on a retry.
admin.openapi(pauseAll, async (c) => {
  const sql = c.get("sql");
  await sql`update global_settings set paused = true`;
  const moved = await moveInBatches(sql, null, parkDeliveries);
  return c.json({ paused: true, deliveries_moved: moved }, 200);
});

admin.openapi(resumeAll, async (c) => {
  const sql = c.get("sql");
  await sql`update global_settings set paused = false`;
  const moved = await moveInBatches(sql, null, unparkDeliveries);
  if (moved > 0) {
    c.executionCtx.waitUntil(wakeDispatcher(c.env));
  }
  return c.json({ paused: false, deliveries_moved: moved }, 200);
});

admin.openapi(pauseTenant, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  await setTenantPaused(sql, id, true);
  const moved = await moveInBatches(sql, id, parkDeliveries);
  return c.json({ paused: true, deliveries_moved: moved }, 200);
});

admin.openapi(resumeTenant, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  await setTenantPaused(sql, id, false);
  const moved = await moveInBatches(sql, id, unparkDeliveries);
  if (moved > 0) {
    c.executionCtx.waitUntil(wakeDispatcher(c.env));
  }
  return c.json({ paused: false, deliveries_moved: moved }, 200);
});

async function setTenantPaused(sql: Sql, tenantId: string, paused: boolean): Promise<void> {
  const updated = await sql`update tenants set paused = ${paused} where id = ${tenantId}`;
  if (updated.count === 0) {
    throw new ApiError(404, "not_found", "Tenant not found");
  }
}
