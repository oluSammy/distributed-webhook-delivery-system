import { createRoute, z } from "@hono/zod-openapi";
import { firstRow, requestHash } from "@wds/core";
import { bodyLimit } from "hono/body-limit";
import type { Sql, TransactionSql } from "postgres";
import { decodeCursor, encodeCursor } from "../cursor";
import { countToday, dailyLimit, limitReached, setUsageHeaders, type Usage } from "../daily-limit";
import { wakeDispatcher } from "../dispatcher";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const MAX_BODY_BYTES = 256 * 1024;
const IDEMPOTENCY_WINDOW = "24 hours";
const MAX_BATCH_SIZE = 500;
const MAX_PAGE = 100;

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

const Event = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.json()),
  created_at: z.string(),
  deliveries_created_at: z.string().nullable(), // when its deliveries were created; null until then
});

const CreateEventHeaders = z.object({
  "idempotency-key": z.string().min(1).max(255).optional(),
});

// The list leaves the payload out (it can be 256 KB): GET /api/events/{id} has it.
const EventSummary = z.object({
  id: z.string(),
  type: z.string(),
  created_at: z.string(),
  deliveries_created_at: z.string().nullable(), // null while its deliveries are still being made
  // Its deliveries, one per matching endpoint, counted by state.
  deliveries: z.object({
    total: z.number(),
    succeeded: z.number(),
    pending: z.number(),
    dead: z.number(),
    cancelled: z.number(),
  }),
});

const ListQuery = z.object({
  type: z.string().max(255).optional(), // only events of this type
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  cursor: z.string().max(200).optional(), // next_cursor from the previous page
});

const listEvents = createRoute({
  method: "get",
  path: "/",
  request: { query: ListQuery },
  responses: {
    200: {
      description:
        "The tenant's events, newest first, each with its deliveries counted by state. Pass next_cursor as cursor for the next page; it's null on the last one.",
      content: {
        "application/json": {
          schema: z.object({ events: z.array(EventSummary), next_cursor: z.string().nullable() }),
        },
      },
    },
  },
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

const getEvent = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "One event, with the payload its deliveries send",
      content: { "application/json": { schema: Event } },
    },
  },
});

type EventSummaryRow = {
  id: string;
  type: string;
  created_at: Date;
  deliveries_created_at: Date | null;
  position: string; // created_at as text, which keeps the microseconds a Date would lose
  total: number;
  succeeded: number;
  pending: number;
  dead: number;
  cancelled: number;
};

type EventRow = {
  id: string;
  type: string;
  payload: EventPayload;
  created_at: Date;
  deliveries_created_at: Date | null;
};

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

// Newest first, read off idx_events_tenant (tenant_id, created_at, id) backwards; each event's
// deliveries are counted with idx_deliveries_event. One more than the page is asked for, to tell
// whether another page follows.
events.openapi(listEvents, async (c) => {
  const query = c.req.valid("query");
  const sql = c.get("sql");
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const rows = await sql<EventSummaryRow[]>`
      select e.id, e.type, e.created_at, e.deliveries_created_at,
             e.created_at::text as position, counts.*
      from events e
      cross join lateral (
        select count(*)::int as total,
               count(*) filter (where d.state = 'succeeded')::int as succeeded,
               count(*) filter (where d.state = 'pending')::int as pending,
               count(*) filter (where d.state = 'dead')::int as dead,
               count(*) filter (where d.state = 'cancelled')::int as cancelled
        from deliveries d
        -- A delivery is never made before its event: the second condition changes nothing but
        -- lets Postgres skip the older days' partitions.
        where d.event_id = e.id and d.created_at >= e.created_at
      ) counts
      where e.tenant_id = ${c.get("tenantId")}
        ${query.type === undefined ? sql`` : sql`and e.type = ${query.type}`}
        ${after === null ? sql`` : sql`and (e.created_at, e.id) < (${after.position}::text::timestamptz, ${after.id})`}
      order by e.created_at desc, e.id desc
      limit ${query.limit + 1}
    `;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor(last) : null;
  return c.json(
    {
      events: page.map((row) => ({
        id: row.id,
        type: row.type,
        created_at: row.created_at.toISOString(),
        deliveries_created_at: row.deliveries_created_at?.toISOString() ?? null,
        deliveries: {
          total: row.total,
          succeeded: row.succeeded,
          pending: row.pending,
          dead: row.dead,
          cancelled: row.cancelled,
        },
      })),
      next_cursor: nextCursor,
    },
    200,
  );
});

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
      ? await insertEvent(sql, tenantId, type, payload, dailyLimit(c.env))
      : await insertEventOnce(sql, tenantId, type, payload, idempotencyKey, dailyLimit(c.env));

  if (accepted.usage) {
    setUsageHeaders(c, accepted.usage);
  }

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

  const { events: inserted, usage } = await insertEvents(sql, tenantId, batch, dailyLimit(c.env));
  setUsageHeaders(c, usage);
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

events.openapi(getEvent, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");

  // Only the id is known, not created_at, so Postgres checks each partition's primary key index
  // for it: one quick lookup per day of retention.
  const [row] = await sql<EventRow[]>`
    select id, type, payload, created_at, deliveries_created_at
    from events
    where tenant_id = ${c.get("tenantId")} and id = ${id}
  `;
  if (!row) {
    throw new ApiError(404, "not_found", "Event not found");
  }
  return c.json(
    {
      id: row.id,
      type: row.type,
      payload: row.payload,
      created_at: row.created_at.toISOString(),
      deliveries_created_at: row.deliveries_created_at?.toISOString() ?? null,
    },
    200,
  );
});

// Header present: a transaction that first tries to claim the key in idempotency_keys, then inserts the
// event. There are three possible outcomes:
// - A new key, or an expired one → the event is created
// - Same key and same body (same request_hash) → the original event is returned with
//   Idempotent-Replayed: true, and nothing new is created
// - Same key, different body → 422 idempotency_key_reused
async function insertEvent(
  sql: Sql,
  tenantId: string,
  type: string,
  payload: EventPayload,
  limit: number,
) {
  // No row back: today's count is at the limit, so neither the count nor the event changed.
  const [row] = await sql<({ id: string; created_at: Date } & Usage)[]>`
    with usage as (${countToday(sql, tenantId, 1, limit)}),
    inserted as (
      insert into events (tenant_id, type, payload)
      select ${tenantId}, ${type}, ${sql.json(payload)} from usage
      returning id, created_at
    ),
    waiting as (${markWaiting(sql, tenantId)})
    select inserted.id, inserted.created_at, usage.events, usage.daily_limit
    from inserted, usage
  `;
  if (!row) {
    throw await limitReached(sql, tenantId, 1, limit);
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    replayed: false,
    usage: { events: row.events, daily_limit: row.daily_limit },
  };
}

async function insertEventOnce(
  sql: Sql,
  tenantId: string,
  type: string,
  payload: EventPayload,
  idempotencyKey: string,
  limit: number,
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
      // Counted only now, once the key is ours: a replay returns the stored event and counts nothing.
      const [usage] = await countToday(tx, tenantId, 1, limit);
      if (!usage) {
        throw await limitReached(tx, tenantId, 1, limit);
      }

      await tx`
        insert into events (id, tenant_id, type, payload, idempotency_key, created_at)
        values (${fresh.id}, ${tenantId}, ${type}, ${tx.json(payload)}, ${idempotencyKey}, ${fresh.created_at})
      `;

      await markWaiting(tx, tenantId);

      return { id: fresh.id, createdAt: fresh.created_at, replayed: false, usage };
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

    return {
      id: existing.event_id,
      createdAt: existing.event_created_at,
      replayed: true,
      usage: undefined,
    };
  });
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
  limit: number,
): Promise<{ events: { id: string; type: string; created_at: Date }[]; usage: Usage }> {
  // The whole batch counts, or none of it: a batch that would pass the limit stores nothing.
  const rows = await sql<({ id: string; type: string; created_at: Date } & Usage)[]>`
    with usage as (${countToday(sql, tenantId, batch.length, limit)}),
    input as (
      select t.position, uuidv7() as id, t.item ->> 'type' as type, t.item -> 'payload' as payload
      from jsonb_array_elements(${sql.json(batch)}) with ordinality as t(item, position)
    ),
    inserted as (
      insert into events (id, tenant_id, type, payload)
      select id, ${tenantId}, type, payload from input, usage
      returning id, created_at
    ),
    waiting as (${markWaiting(sql, tenantId)})
    select inserted.id, input.type, inserted.created_at, usage.events, usage.daily_limit
    from inserted
    join input using (id)
    cross join usage
    order by input.position
  `;
  const [first] = rows;
  if (!first) {
    throw await limitReached(sql, tenantId, batch.length, limit);
  }
  return {
    events: rows.map(({ id, type, created_at }) => ({ id, type, created_at })),
    usage: { events: first.events, daily_limit: first.daily_limit },
  };
}

// Puts the tenant in tenants_with_events, so the Creator Worker takes its new events in its turn.
// Run in the same statement or transaction as the insert into events. If the tenant is already
// there, it keeps its place in line, and "do update … where false" changes nothing but locks its
// row until this commits: that's what stops the Creator Worker from removing the tenant while this
// event isn't visible yet (see removeEmptied in apps/creator/src/create-deliveries.ts).
function markWaiting(sql: Sql | TransactionSql, tenantId: string) {
  return sql`
    insert into tenants_with_events (tenant_id) values (${tenantId})
    on conflict (tenant_id) do update set last_served_at = tenants_with_events.last_served_at
    where false
  `;
}
