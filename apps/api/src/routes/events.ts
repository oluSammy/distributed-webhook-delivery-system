import { createRoute, z } from "@hono/zod-openapi";
import { firstRow, requestHash } from "@wds/core";
import type { DispatcherApi } from "@wds/dispatcher/contract";
import { bodyLimit } from "hono/body-limit";
import type { Sql } from "postgres";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const MAX_BODY_BYTES = 256 * 1024;
const IDEMPOTENCY_WINDOW = "24 hours";
const MAX_BATCH_SIZE = 500;

type EventPayload = z.infer<typeof CreateEventBody>["payload"];
type EventInput = z.infer<typeof CreateEventBody>;

const CreateEventBody = z.object({
  type: z.string().min(1).max(255),
  payload: z.record(z.string(), z.json()),
});

const CreateEventBatchBody = z.object({
  events: z.array(CreateEventBody).min(1).max(MAX_BATCH_SIZE),
});

const EventAccepted = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string(),
});

const EventBatchAccepted = z.object({
  events: z.array(EventAccepted),
});

const CreateEventHeaders = z.object({
  "idempotency-key": z.string().min(1).max(255).optional(),
});

const createEvent = createRoute({
  method: "post",
  path: "/",
  request: {
    headers: CreateEventHeaders,
    body: { content: { "application/json": { schema: CreateEventBody } }, required: true },
  },
  responses: {
    202: {
      description: "Event accepted for delivery",
      content: { "application/json": { schema: EventAccepted } },
    },
  },
});

const createEventBatch = createRoute({
  method: "post",
  path: "/batch",
  request: {
    body: { content: { "application/json": { schema: CreateEventBatchBody } }, required: true },
  },
  responses: {
    202: {
      description: "All events in the batch accepted for delivery",
      content: { "application/json": { schema: EventBatchAccepted } },
    },
  },
});

export const events = createRouter();

events.use(
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json({ error: { code: "payload_too_large", message: "Request body exceeds 256 KB" } }, 413),
  }),
);

events.openapi(createEvent, async (c) => {
  const { type, payload } = c.req.valid("json");
  const { "idempotency-key": idempotencyKey } = c.req.valid("header");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");

  await requireKnownTypes(sql, tenantId, [type]);

  const accepted =
    idempotencyKey === undefined
      ? await insertEvent(sql, tenantId, type, payload)
      : await insertEventOnce(sql, tenantId, type, payload, idempotencyKey);

  if (accepted.replayed) {
    c.header("Idempotent-Replayed", "true");
  } else {
    c.executionCtx.waitUntil(wakeDispatcher(c.env));
  }

  return c.json({ id: accepted.id, type, created_at: accepted.createdAt.toISOString() }, 202);
});

events.openapi(createEventBatch, async (c) => {
  const { events: batch } = c.req.valid("json");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");

  await requireKnownTypes(
    sql,
    tenantId,
    batch.map((event) => event.type),
  );

  const inserted = await insertEvents(sql, tenantId, batch);
  c.executionCtx.waitUntil(wakeDispatcher(c.env));

  return c.json(
    {
      events: inserted.map((row) => ({
        id: row.id,
        type: row.type,
        created_at: row.created_at.toISOString(),
      })),
    },
    202,
  );
});

async function insertEvent(sql: Sql, tenantId: string, type: string, payload: EventPayload) {
  const { created_at, id } = firstRow(
    await sql<{ id: string; created_at: Date }[]>`
    insert into events (tenant_id, type, payload)
    values (${tenantId}, ${type}, ${sql.json(payload)})
    returning id, created_at
  `,
  );

  return { id, createdAt: created_at, replayed: false };
}

async function insertEventOnce(
  sql: Sql,
  tenantId: string,
  type: string,
  payload: EventPayload,
  idempotencyKey: string,
) {
  const hash = await requestHash(type, payload);

  return sql.begin(async (tx) => {
    // now() must be the database's time, and specifically this transaction's time

    const fresh = firstRow(
      await tx<{ id: string; created_at: Date }[]>`select uuidv7() as id, now() as created_at`,
    );

    // claimed: we got the key (it was new, or expired and taken over), so create the event
    const [claimed] = await tx`
      insert into idempotency_keys
        (tenant_id, key, event_id, event_created_at, request_hash, expires_at)
      values
        (${tenantId}, ${idempotencyKey}, ${fresh.id}, ${fresh.created_at}, ${hash}, now() + ${IDEMPOTENCY_WINDOW}::interval)
      on conflict (tenant_id, key) do update
        set event_id = excluded.event_id,
            event_created_at = excluded.event_created_at,
            request_hash = excluded.request_hash,
            expires_at = excluded.expires_at
        where idempotency_keys.expires_at < now()
      returning event_id
    `;

    if (claimed) {
      await tx`
        insert into events (id, tenant_id, type, payload, idempotency_key, created_at)
        values (${fresh.id}, ${tenantId}, ${type}, ${tx.json(payload)}, ${idempotencyKey}, ${fresh.created_at})
      `;

      return { id: fresh.id, createdAt: fresh.created_at, replayed: false };
    }

    // request_hash = ${hash} as same_request because two answers from one query: who owns the key, and whether it's the same request.
    const existing = firstRow(
      await tx<{ event_id: string; event_created_at: Date; same_request: boolean }[]>`
        select event_id, event_created_at, request_hash = ${hash} as same_request
        from idempotency_keys
        where tenant_id = ${tenantId} and key = ${idempotencyKey}
      `,
    );

    if (!existing.same_request) {
      throw new ApiError(
        422,
        "idempotency_key_reused",
        "This Idempotency-Key was already used for a different request",
      );
    }

    return { id: existing.event_id, createdAt: existing.event_created_at, replayed: true };
  });
}

function wakeDispatcher(env: Env): Promise<unknown> {
  const dispatchers = env.DISPATCHER as DurableObjectNamespace<DispatcherApi>;
  return dispatchers
    .getByName("shard-0")
    .wake()
    .catch((err) => console.error("wake failed", err));
}

async function requireKnownTypes(sql: Sql, tenantId: string, types: string[]): Promise<void> {
  const wanted = [...new Set(types)];
  const known = await sql<{ name: string }[]>`
    select name from event_types
    where tenant_id = ${tenantId}
      and name in (select jsonb_array_elements_text(${sql.json(wanted)}))
  `;
  const knownNames = new Set(known.map((row) => row.name));
  const unknown = wanted.filter((name) => !knownNames.has(name));
  if (unknown.length > 0) {
    throw new ApiError(
      422,
      "unknown_event_type",
      `Event type(s) not registered: ${unknown.map((name) => `"${name}"`).join(", ")}`,
    );
  }
}

async function insertEvents(
  sql: Sql,
  tenantId: string,
  batch: EventInput[],
): Promise<{ id: string; type: string; created_at: Date }[]> {
  return sql<{ id: string; type: string; created_at: Date }[]>`
    with input as (
      select t.position, uuidv7() as id, t.item ->> 'type' as type, t.item -> 'payload' as payload
      from jsonb_array_elements(${sql.json(batch)}) with ordinality as t(item, position)
    ),
    inserted as (
      insert into events (id, tenant_id, type, payload)
      select id, ${tenantId}, type, payload from input
      returning id, created_at
    )
    select inserted.id, input.type, inserted.created_at
    from inserted
    join input using (id)
    order by input.position
  `;
}
