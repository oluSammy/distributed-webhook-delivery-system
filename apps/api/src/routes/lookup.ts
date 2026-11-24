import { createRoute, z } from "@hono/zod-openapi";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const Kind = z.enum(["endpoint", "delivery", "event"]);

const lookup = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description:
        "What this id is in the tenant: an endpoint (not deleted), a delivery or an event. 404 when it's none of them, or another tenant's.",
      content: { "application/json": { schema: z.object({ kind: Kind, id: z.string() }) } },
    },
  },
});

export const lookups = createRouter();

// For the dashboard's search box: someone pastes an id from a log or an email, and goes straight
// to it. Ids are UUIDs and never shared between tables, so at most one of these finds it. Deliveries
// and events are looked up by id alone, which checks each daily partition's primary key: one quick
// lookup per day kept, as GET /api/events/{id} does.
lookups.openapi(lookup, async (c) => {
  const { id } = c.req.valid("param");
  const tenantId = c.get("tenantId");
  const [row] = await c.get("sql")<{ kind: z.infer<typeof Kind> }[]>`
      select 'endpoint' as kind from endpoints
      where tenant_id = ${tenantId} and id = ${id} and state <> 'deleted'
      union all
      select 'delivery' from deliveries where tenant_id = ${tenantId} and id = ${id}
      union all
      select 'event' from events where tenant_id = ${tenantId} and id = ${id}
      limit 1
    `;
  if (!row) {
    throw new ApiError(404, "not_found", "No endpoint, delivery or event with this id here");
  }
  return c.json({ kind: row.kind, id }, 200);
});
