import { createRoute, z } from "@hono/zod-openapi";
import type { Fragment, Sql } from "postgres";
import { wakeDispatcher } from "../dispatcher";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const MAX_PAGE = 100;
const MAX_BULK = 1000;

const DeadDelivery = z.object({
  id: z.string(),
  event_id: z.string(),
  event_type: z.string(),
  endpoint_id: z.string(),
  failure_reason: z.string(),
  attempt_count: z.number(),
  throttled_count: z.number(),
  created_at: z.string(),
  finished_at: z.string(),
  last_status: z.number().nullable(), // the final attempt's HTTP status; null if no response came back
  last_error_kind: z.string().nullable(),
});

// The filters the list and the bulk actions share.
const DeadFilters = z.object({
  endpoint_id: z.uuid().optional(),
  event_type: z.string().max(200).optional(),
  reason: z.string().max(100).optional(),
  since: z.iso.datetime({ offset: true }).optional(), // created at or after
  until: z.iso.datetime({ offset: true }).optional(), // created before
});

const ListQuery = DeadFilters.extend({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  cursor: z.string().max(200).optional(), // next_cursor from the previous page
});

// Bulk redeliver and discard: the deliveries in ids (if given) that match the filters.
const BulkBody = DeadFilters.extend({
  ids: z.array(z.uuid()).min(1).max(MAX_PAGE).optional(),
  limit: z.number().int().min(1).max(MAX_BULK).default(100),
});

const Discarded = z.object({
  id: z.string(),
  resolved_at: z.string(),
});

const Redelivered = z.object({
  id: z.string(), // the new delivery
  redelivered_from: z.string(), // the dead one
  created_at: z.string(),
});

const listDead = createRoute({
  method: "get",
  path: "/",
  request: { query: ListQuery },
  responses: {
    200: {
      description:
        "Dead deliveries, newest first. Pass next_cursor as cursor for the next page; it's null on the last one.",
      content: {
        "application/json": {
          schema: z.object({
            deliveries: z.array(DeadDelivery),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
  },
});

const redeliverOne = createRoute({
  method: "post",
  path: "/{id}/redeliver",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    202: {
      description: "A new delivery of the same event to the same endpoint, due now",
      content: { "application/json": { schema: Redelivered } },
    },
  },
});

const redeliverMany = createRoute({
  method: "post",
  path: "/redeliver",
  request: {
    body: { content: { "application/json": { schema: BulkBody } }, required: true },
  },
  responses: {
    202: {
      description:
        "Redelivers up to limit matching dead deliveries, newest first. Fewer than limit means none are left.",
      content: {
        "application/json": { schema: z.object({ deliveries: z.array(Redelivered) }) },
      },
    },
  },
});

const discardOne = createRoute({
  method: "post",
  path: "/{id}/discard",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The dead delivery leaves the DLQ without being sent again",
      content: { "application/json": { schema: Discarded } },
    },
  },
});

const discardMany = createRoute({
  method: "post",
  path: "/discard",
  request: {
    body: { content: { "application/json": { schema: BulkBody } }, required: true },
  },
  responses: {
    200: {
      description:
        "Discards up to limit matching dead deliveries, newest first. Fewer than limit means none are left.",
      content: {
        "application/json": { schema: z.object({ deliveries: z.array(Discarded) }) },
      },
    },
  },
});

function bulkCondition(sql: Sql, body: z.infer<typeof BulkBody>): Fragment {
  return sql`
    ${body.ids === undefined ? sql`` : sql`and d.id in ${sql(body.ids)}`}
    ${deadFilters(sql, body)}
  `;
}

type DeadDeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  failure_reason: string;
  attempt_count: number;
  throttled_count: number;
  created_at: Date;
  finished_at: Date;
  position: string; // created_at as text, which keeps the microseconds a Date would lose
  last_status: number | null;
  last_error_kind: string | null;
};

export const dlq = createRouter();

dlq.openapi(listDead, async (c) => {
  const query = c.req.valid("query");
  const sql = c.get("sql");
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);

  // One more than the page, to tell whether another page follows. The cursor's position goes in
  // as text: sent as a timestamptz, postgres.js would turn it into a Date and drop the microseconds.
  const rows = await sql<DeadDeliveryRow[]>`
      select d.id, d.event_id, ev.type as event_type, d.endpoint_id, d.failure_reason,
            d.attempt_count, d.throttled_count, d.created_at, d.finished_at,
            d.created_at::text as position,
            last.response_status as last_status, last.error_kind as last_error_kind
      from deliveries d
      join events ev on ev.id = d.event_id and ev.created_at = d.event_created_at
      left join lateral (
        select t.response_status, t.error_kind
        from (
          select a.attempt_number, a.response_status, a.error_kind
          from delivery_attempts a
          where a.delivery_id = d.id and a.started_at >= d.created_at and not a.stale
          union all
          select x.attempt_number, x.response_status, x.error_kind
          from dead_delivery_attempts x
          where x.delivery_id = d.id and not x.stale
        ) t
        order by t.attempt_number desc
        limit 1
      ) last on true
      where d.tenant_id = ${c.get("tenantId")}
          and d.state = 'dead'
          and d.resolution is null
          ${deadFilters(sql, query)}
          ${after === null ? sql`` : sql`and (d.created_at, d.id) < (${after.position}::text::timestamptz, ${after.id})`}
      order by d.created_at desc, d.id desc
      limit ${query.limit + 1}
    `;

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor(last) : null;
  return c.json({ deliveries: page.map(toResponse), next_cursor: nextCursor }, 200);
});

dlq.openapi(redeliverOne, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");

  const [row] = await redeliver(sql, tenantId, sql`and d.id = ${id}`, 1);
  if (!row) {
    throw await cannotResolve(sql, tenantId, id, "redelivered");
  }
  c.executionCtx.waitUntil(wakeDispatcher(c.env));
  return c.json(toRedeliveredResponse(row), 202);
});

dlq.openapi(redeliverMany, async (c) => {
  const body = c.req.valid("json");
  const sql = c.get("sql");

  const rows = await redeliver(sql, c.get("tenantId"), bulkCondition(sql, body), body.limit);
  if (rows.length > 0) {
    c.executionCtx.waitUntil(wakeDispatcher(c.env));
  }
  return c.json({ deliveries: rows.map(toRedeliveredResponse) }, 202);
});

dlq.openapi(discardOne, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");

  const [row] = await discard(sql, tenantId, sql`and d.id = ${id}`, 1);
  if (!row) {
    throw await cannotResolve(sql, tenantId, id, "discarded");
  }
  return c.json(toDiscardedResponse(row), 200);
});

dlq.openapi(discardMany, async (c) => {
  const body = c.req.valid("json");
  const sql = c.get("sql");
  const rows = await discard(sql, c.get("tenantId"), bulkCondition(sql, body), body.limit);
  return c.json({ deliveries: rows.map(toDiscardedResponse) }, 200);
});

// The DeadFilters that were given, as SQL conditions on d (deliveries) and ev (events).
function deadFilters(sql: Sql, filters: z.infer<typeof DeadFilters>): Fragment {
  return sql`
      ${filters.endpoint_id === undefined ? sql`` : sql`and d.endpoint_id = ${filters.endpoint_id}`}
      ${filters.event_type === undefined ? sql`` : sql`and ev.type = ${filters.event_type}`}
      ${filters.reason === undefined ? sql`` : sql`and d.failure_reason = ${filters.reason}`}
      ${filters.since === undefined ? sql`` : sql`and d.created_at >= ${filters.since}`}
      ${filters.until === undefined ? sql`` : sql`and d.created_at < ${filters.until}`}
    `;
}

// The cursor is the last row's position and id, so the next page starts right after it even when
// several deliveries were created in the same microsecond. Base64url keeps it opaque and URL-safe.
function encodeCursor(row: DeadDeliveryRow): string {
  return btoa(JSON.stringify([row.position, row.id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeCursor(cursor: string): { position: string; id: string } {
  try {
    const [position, id] = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
    if (typeof position === "string" && z.uuid().safeParse(id).success) {
      return { position, id };
    }
  } catch {
    // not base64 or not JSON: rejected below
  }
  throw new ApiError(400, "invalid_cursor", "cursor is not one this API returned");
}

function toResponse(row: DeadDeliveryRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    event_type: row.event_type,
    endpoint_id: row.endpoint_id,
    failure_reason: row.failure_reason,
    attempt_count: row.attempt_count,
    throttled_count: row.throttled_count,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at.toISOString(),
    last_status: row.last_status,
    last_error_kind: row.last_error_kind,
  };
}

type RedeliveredRow = { id: string; redelivered_from: string; created_at: Date };

// Redelivers the matching dead deliveries still in the DLQ. Each one is marked redelivered and gets
// a new delivery of the same event to the same endpoint: redelivered_from points back, the retry
// budget starts again, and its queue entry is due now. The dead one stays dead.
// for update locks the picked rows, so two requests for the same delivery can't both redeliver
// it: the second waits, then sees it resolved and skips it. A deleted endpoint, or an event no
// longer stored, is skipped too (the join finds nothing).
function redeliver(sql: Sql, tenantId: string, condition: Fragment, limit: number) {
  return sql<RedeliveredRow[]>`
      with picked as (
        select d.id, d.created_at
        from deliveries d
        join events ev on ev.id = d.event_id and ev.created_at = d.event_created_at
        join endpoints en on en.id = d.endpoint_id and en.state <> 'deleted'
        where d.tenant_id = ${tenantId}
          and d.state = 'dead'
          and d.resolution is null
          ${condition}
        order by d.created_at desc, d.id desc
        limit ${limit}
        for update of d
      ),
      resolved as (
        update deliveries d
        set resolution = 'redelivered', resolved_at = now()
        from picked p
        where d.id = p.id and d.created_at = p.created_at
        returning d.id, d.tenant_id, d.event_id, d.event_created_at, d.endpoint_id
      ),
      created as (
        insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id, redelivered_from)
        select tenant_id, event_id, event_created_at, endpoint_id, id from resolved
        returning id, created_at, tenant_id, endpoint_id, redelivered_from
      ),
      queued as (
        insert into delivery_queue (delivery_id, delivery_created_at, tenant_id, endpoint_id, next_attempt_at)
        select id, created_at, tenant_id, endpoint_id, now() from created
      ),
      tenants as (
        insert into tenants_with_work (tenant_id)
        select distinct tenant_id from created
        on conflict do nothing
      )
      select id, redelivered_from, created_at from created
    `;
}

// Works out why redeliver found nothing for this id, for the error.
async function cannotResolve(
  sql: Sql,
  tenantId: string,
  id: string,
  resolution: "redelivered" | "discarded",
): Promise<ApiError> {
  const [row] = await sql<{ state: string; resolution: string | null; endpoint_state: string }[]>`
      select d.state, d.resolution, en.state as endpoint_state
      from deliveries d
      join endpoints en on en.id = d.endpoint_id
      where d.tenant_id = ${tenantId} and d.id = ${id}
    `;
  if (!row) {
    return new ApiError(404, "not_found", "Delivery not found");
  }
  if (row.state !== "dead") {
    return new ApiError(
      409,
      "not_dead",
      `Only dead deliveries can be ${resolution}; this one is ${row.state}`,
    );
  }
  if (row.resolution !== null) {
    return new ApiError(409, "already_resolved", `This delivery was already ${row.resolution}`);
  }
  if (row.endpoint_state === "deleted") {
    return new ApiError(409, "endpoint_deleted", "This delivery's endpoint has been deleted");
  }
  return new ApiError(409, "event_expired", "This delivery's event is no longer stored");
}

function toRedeliveredResponse(row: RedeliveredRow) {
  return {
    id: row.id,
    redelivered_from: row.redelivered_from,
    created_at: row.created_at.toISOString(),
  };
}

type DiscardedRow = { id: string; resolved_at: Date };

// Discards the matching dead deliveries still in the DLQ: they're marked discarded and leave it,
// and nothing is sent. Locked like redeliver, so a delivery is resolved only once. The event join
// is a left join, so a delivery whose event is no longer stored can still be discarded.
function discard(sql: Sql, tenantId: string, condition: Fragment, limit: number) {
  return sql<DiscardedRow[]>`
      with picked as (
        select d.id, d.created_at
        from deliveries d
        left join events ev on ev.id = d.event_id and ev.created_at = d.event_created_at
        where d.tenant_id = ${tenantId}
          and d.state = 'dead'
          and d.resolution is null
          ${condition}
        order by d.created_at desc, d.id desc
        limit ${limit}
        for update of d
      )
      update deliveries d
      set resolution = 'discarded', resolved_at = now()
      from picked p
      where d.id = p.id and d.created_at = p.created_at
      returning d.id, d.resolved_at
    `;
}

function toDiscardedResponse(row: DiscardedRow) {
  return { id: row.id, resolved_at: row.resolved_at.toISOString() };
}
