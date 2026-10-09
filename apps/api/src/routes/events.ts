import { createRoute, z } from "@hono/zod-openapi";
import type { DispatcherApi } from "@wds/dispatcher/contract";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const CreateEventBody = z.object({
  type: z.string().min(1).max(255),
  payload: z.record(z.string(), z.json()),
});

const EventAccepted = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string(),
});

const createEvent = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: CreateEventBody } }, required: true },
  },
  responses: {
    202: {
      description: "Event accepted for delivery",
      content: { "application/json": { schema: EventAccepted } },
    },
  },
});

export const events = createRouter();

events.openapi(createEvent, async (c) => {
  const { type, payload } = c.req.valid("json");
  const sql = c.get("sql");

  const tenantId = c.get("tenantId");

  const [eventType] = await sql`
        select 1 from event_types where tenant_id = ${tenantId} and name = ${type}
    `;

  if (!eventType) {
    throw new ApiError(422, "unknown_event_type", `Event type "${type}" is not registered`);
  }

  const [event] = await sql<{ id: string; created_at: Date }[]>`
        insert into events (tenant_id, type, payload)
        values(${tenantId}, ${type}, ${sql.json(payload)})
        returning id, created_at
    `;

  if (!event) {
    throw new Error("error inserting rows into events");
  }

  const dispatchers = c.env.DISPATCHER as DurableObjectNamespace<DispatcherApi>;
  c.executionCtx.waitUntil(
    dispatchers
      .getByName("shard-0")
      .wake()
      .catch((err) => console.error("wake failed", err)),
  );

  return c.json({ id: event.id, type, created_at: event.created_at.toISOString() }, 202);
});
