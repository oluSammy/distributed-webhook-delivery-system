import { createRoute, z } from "@hono/zod-openapi";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const MAX_PAGE = 100;

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

const ListQuery = z.object({
  endpoint_id: z.uuid().optional(),
  event_type: z.string().max(200).optional(),
  reason: z.string().max(100).optional(),
  since: z.iso.datetime({ offset: true }).optional(), // created at or after
  until: z.iso.datetime({ offset: true }).optional(), // created before
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  cursor: z.string().max(200).optional(), // next_cursor from the previous page
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
        ${query.endpoint_id === undefined ? sql`` : sql`and d.endpoint_id = ${query.endpoint_id}`}
        ${query.event_type === undefined ? sql`` : sql`and ev.type = ${query.event_type}`}
        ${query.reason === undefined ? sql`` : sql`and d.failure_reason = ${query.reason}`}
        ${query.since === undefined ? sql`` : sql`and d.created_at >= ${query.since}`}
        ${query.until === undefined ? sql`` : sql`and d.created_at < ${query.until}`}
        ${after === null ? sql`` : sql`and (d.created_at, d.id) < (${after.position}::text::timestamptz, ${after.id})`}
      order by d.created_at desc, d.id desc
      limit ${query.limit + 1}
    `;

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor(last) : null;
  return c.json({ deliveries: page.map(toResponse), next_cursor: nextCursor }, 200);
});

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
