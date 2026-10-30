import { createRoute, z } from "@hono/zod-openapi";
import type { Fragment, Sql } from "postgres";
import { ApiError } from "../errors";
import { createRouter } from "../router";

const Delivery = z.object({
  id: z.string(),
  event_id: z.string(),
  endpoint_id: z.string(),
  state: z.string(),
  attempt_count: z.number(),
  throttled_count: z.number(),
  failure_reason: z.string().nullable(),
  redelivered_from: z.string().nullable(),
  resolution: z.string().nullable(), // a dead delivery: redelivered or discarded, null while in the DLQ
  resolved_at: z.string().nullable(),
  next_attempt_at: z.string().nullable(),
  in_flight: z.boolean(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

const Attempt = z.object({
  attempt_number: z.number(),
  outcome: z.string(),
  response_status: z.number().nullable(),
  response_body: z.string().nullable(),
  error_kind: z.string().nullable(),
  latency_ms: z.number().nullable(),
  stale: z.boolean(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

const DeliveryWithAttempts = Delivery.extend({
  attempts: z.array(Attempt),
});

const listDeliveries = createRoute({
  method: "get",
  path: "/",
  request: { query: z.object({ event_id: z.uuid() }) },
  responses: {
    200: {
      description: "The event's deliveries, one per endpoint it was sent to",
      content: { "application/json": { schema: z.object({ deliveries: z.array(Delivery) }) } },
    },
  },
});

const getDelivery = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "One delivery with every attempt, oldest first",
      content: { "application/json": { schema: DeliveryWithAttempts } },
    },
  },
});

type DeliveryRow = {
  id: string;
  event_id: string;
  endpoint_id: string;
  state: string;
  attempt_count: number;
  throttled_count: number;
  failure_reason: string | null;
  redelivered_from: string | null;
  resolution: string | null;
  resolved_at: Date | null;
  next_attempt_at: Date | null;
  in_flight: boolean;
  created_at: Date;
  finished_at: Date | null;
};

type AttemptRow = {
  attempt_number: number;
  outcome: string;
  response_status: number | null;
  response_body_truncated: string | null;
  error_kind: string | null;
  latency_ms: number | null;
  stale: boolean;
  started_at: Date;
  finished_at: Date | null;
};

export const deliveries = createRouter();

deliveries.openapi(listDeliveries, async (c) => {
  const { event_id } = c.req.valid("query");
  const sql = c.get("sql");
  const rows = await selectDeliveries(sql, c.get("tenantId"), sql`d.event_id = ${event_id}`);
  return c.json({ deliveries: rows.map(toResponse) }, 200);
});

deliveries.openapi(getDelivery, async (c) => {
  const { id } = c.req.valid("param");
  const sql = c.get("sql");
  const [row] = await selectDeliveries(sql, c.get("tenantId"), sql`d.id = ${id}`);
  if (!row) {
    throw new ApiError(404, "not_found", "Delivery not found");
  }

  // Only after the tenant check above: attempts have no tenant_id of their own. A dead delivery's
  // attempts move to dead_delivery_attempts when their partition is dropped, so read both.
  // started_at >= created_at changes nothing but lets Postgres skip older partitions.
  const attempts = await sql<AttemptRow[]>`
      select attempt_number, outcome, response_status, response_body_truncated, error_kind,
              latency_ms, stale, started_at, finished_at
      from delivery_attempts
      where delivery_id = ${id} and started_at >= ${row.created_at}
      union all
      select attempt_number, outcome, response_status, response_body_truncated, error_kind,
              latency_ms, stale, started_at, finished_at
      from dead_delivery_attempts
      where delivery_id = ${id}
      order by attempt_number, started_at
      `;
  return c.json({ ...toResponse(row), attempts: attempts.map(toAttemptResponse) }, 200);
});

// A pending delivery's queue row says when it's next due, and whether a call holds it right now
// (then next_attempt_at is when that claim's lease runs out).
function selectDeliveries(sql: Sql, tenantId: string, condition: Fragment) {
  return sql<DeliveryRow[]>`
    select d.id, d.event_id, d.endpoint_id, d.state, d.attempt_count, d.throttled_count,
      d.failure_reason, d.redelivered_from, d.resolution, d.resolved_at, q.next_attempt_at,
      q.claim_token is not null as in_flight, d.created_at, d.finished_at
    from deliveries d
    left join delivery_queue q on q.delivery_id = d.id
    where d.tenant_id = ${tenantId}
    and ${condition}
    order by d.created_at, d.id
    `;
}

function toResponse(row: DeliveryRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    endpoint_id: row.endpoint_id,
    state: row.state,
    attempt_count: row.attempt_count,
    throttled_count: row.throttled_count,
    failure_reason: row.failure_reason,
    redelivered_from: row.redelivered_from,
    resolution: row.resolution,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    next_attempt_at: row.next_attempt_at?.toISOString() ?? null,
    in_flight: row.in_flight,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
  };
}

function toAttemptResponse(row: AttemptRow) {
  return {
    attempt_number: row.attempt_number,
    outcome: row.outcome,
    response_status: row.response_status,
    response_body: row.response_body_truncated,
    error_kind: row.error_kind,
    latency_ms: row.latency_ms,
    stale: row.stale,
    started_at: row.started_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
  };
}
