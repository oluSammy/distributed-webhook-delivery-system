import { createRoute, z } from "@hono/zod-openapi";
import { firstRow } from "@wds/core";
import type { Sql } from "postgres";
import { ApiError } from "../errors";
import { createRouter } from "../router";

// Lowercase words separated by dots, like order.paid: the same rule as the database's.
const TypeName = z
  .string()
  .max(255)
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "Lowercase letters, digits and _, separated by dots");

const EventType = z.object({
  name: z.string(),
  created_at: z.string(),
  // Endpoints (not deleted) with a subscription that matches it, by the same rule as creating
  // deliveries. 0 means its events reach nobody.
  endpoints: z.number(),
});

const listTypes = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description:
        "The tenant's registered event types, by name. POST /api/events accepts only these.",
      content: { "application/json": { schema: z.object({ event_types: z.array(EventType) }) } },
    },
  },
});

const addType = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: z.object({ name: TypeName }) } } },
  },
  responses: {
    201: {
      description: "Registered: events of this type are accepted from now on",
      content: { "application/json": { schema: EventType } },
    },
  },
});

const removeType = createRoute({
  method: "delete",
  path: "/{name}",
  request: { params: z.object({ name: TypeName }) },
  responses: {
    204: {
      description:
        "Removed: new events of this type get 422. Events already received keep their deliveries, and subscriptions stay, so adding it back makes them work again.",
    },
  },
});

export const eventTypes = createRouter();

eventTypes.openapi(listTypes, async (c) => {
  const rows = await selectTypes(c.get("sql"), c.get("tenantId"));
  return c.json({ event_types: rows.map(toResponse) }, 200);
});

eventTypes.openapi(addType, async (c) => {
  const { name } = c.req.valid("json");
  const sql = c.get("sql");
  const [added] = await sql`
      insert into event_types (tenant_id, name) values (${c.get("tenantId")}, ${name})
      on conflict (tenant_id, name) do nothing
      returning name
    `;
  if (!added) {
    throw new ApiError(409, "event_type_exists", `${name} is already registered`);
  }
  return c.json(toResponse(firstRow(await selectTypes(sql, c.get("tenantId"), name))), 201);
});

eventTypes.openapi(removeType, async (c) => {
  const { name } = c.req.valid("param");
  const [row] = await c.get("sql")`
      delete from event_types where tenant_id = ${c.get("tenantId")} and name = ${name}
      returning name
    `;
  if (!row) {
    throw new ApiError(404, "event_type_not_found", `${name} isn't registered`);
  }
  return c.body(null, 204);
});

// The tenant's types (or just one), each with how many endpoints its events would reach: endpoints
// not deleted, with a subscription that matches by event_type_matches, as creating deliveries does.
function selectTypes(sql: Sql, tenantId: string, name?: string) {
  return sql<TypeRow[]>`
      select t.name, t.created_at, counts.endpoints
      from event_types t
      cross join lateral (
        select count(distinct e.id)::int as endpoints
        from endpoints e
        join endpoint_subscriptions s on s.endpoint_id = e.id
        where e.tenant_id = t.tenant_id and e.state <> 'deleted'
          and event_type_matches(s.event_type_pattern, t.name)
      ) counts
      where t.tenant_id = ${tenantId}
        ${name === undefined ? sql`` : sql`and t.name = ${name}`}
      order by t.name
    `;
}

type TypeRow = { name: string; created_at: Date; endpoints: number };

function toResponse(row: TypeRow) {
  return { name: row.name, created_at: row.created_at.toISOString(), endpoints: row.endpoints };
}
