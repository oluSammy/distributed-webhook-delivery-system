import { createRoute, z } from "@hono/zod-openapi";
import { firstRow } from "@wds/core";
import { createRouter } from "../router";

// Each range the Overview offers, and the size of one step of its chart.
const RANGES = {
  "1h": { rangeMs: 60 * 60_000, stepMs: 5 * 60_000 }, // 12 steps of 5 minutes
  "24h": { rangeMs: 24 * 3_600_000, stepMs: 3_600_000 }, // 24 hourly steps
  "7d": { rangeMs: 7 * 86_400_000, stepMs: 6 * 3_600_000 }, // 28 steps of 6 hours
} as const;

const Outcomes = z.object({
  succeeded: z.number(),
  dead: z.number(),
  pending: z.number(),
});

const Stats = z.object({
  range: z.enum(["1h", "24h", "7d"]),
  since: z.string(), // the start of the first step
  step_seconds: z.number(),
  events: z.number(), // events received since then
  deliveries: Outcomes, // deliveries made since then, by how they ended (so far)
  failing_now: z.number(), // still being retried after at least one failure, whenever they began
  dead_in_dlq: z.number(), // dead and not yet redelivered or discarded
  // The deliveries made in each step, by how they ended; every step, empty ones included.
  series: z.array(Outcomes.extend({ at: z.string() })),
});

const getStats = createRoute({
  method: "get",
  path: "/",
  request: { query: z.object({ range: z.enum(["1h", "24h", "7d"]).default("24h") }) },
  responses: {
    200: {
      description: "The Overview's numbers and chart for the range",
      content: { "application/json": { schema: Stats } },
    },
  },
});

export const stats = createRouter();

// The range starts on a step boundary (counted from 1970, like date_bin's origin below), so the
// chart's steps are whole hours or whole 5 minutes, and the last one is the one now running.
stats.openapi(getStats, async (c) => {
  const { range } = c.req.valid("query");
  const { rangeMs, stepMs } = RANGES[range];
  const sql = c.get("sql");
  const tenantId = c.get("tenantId");
  const since = new Date(Math.floor((Date.now() - rangeMs) / stepMs) * stepMs + stepMs);
  const step = `${stepMs / 1000} seconds`;

  const [totals, buckets] = await Promise.all([
    sql<
      {
        events: number;
        succeeded: number;
        dead: number;
        pending: number;
        failing_now: number;
        dead_in_dlq: number;
      }[]
    >`
        select
          (select count(*)::int from events
            where tenant_id = ${tenantId} and created_at >= ${since}) as events,
          count(*) filter (where d.state = 'succeeded')::int as succeeded,
          count(*) filter (where d.state = 'dead')::int as dead,
          count(*) filter (where d.state = 'pending')::int as pending,
          (select count(*)::int
            from delivery_queue q
            join deliveries f on f.id = q.delivery_id and f.created_at = q.delivery_created_at
            where q.tenant_id = ${tenantId} and f.attempt_count > 0) as failing_now,
          (select count(*)::int from deliveries
            where tenant_id = ${tenantId} and state = 'dead' and resolution is null) as dead_in_dlq
        from deliveries d
        where d.tenant_id = ${tenantId} and d.created_at >= ${since}
      `,
    sql<{ at: Date; succeeded: number; dead: number; pending: number }[]>`
        select date_bin(${step}::interval, d.created_at, timestamptz '1970-01-01 00:00:00+00') as at,
               count(*) filter (where d.state = 'succeeded')::int as succeeded,
               count(*) filter (where d.state = 'dead')::int as dead,
               count(*) filter (where d.state = 'pending')::int as pending
        from deliveries d
        where d.tenant_id = ${tenantId} and d.created_at >= ${since}
        group by 1
      `,
  ]);
  const row = firstRow(totals);

  // Every step, from since to now, with zeros where nothing happened.
  const byStep = new Map(buckets.map((bucket) => [bucket.at.getTime(), bucket]));
  const series = [];
  for (let at = since.getTime(); at <= Date.now(); at += stepMs) {
    const bucket = byStep.get(at);
    series.push({
      at: new Date(at).toISOString(),
      succeeded: bucket?.succeeded ?? 0,
      dead: bucket?.dead ?? 0,
      pending: bucket?.pending ?? 0,
    });
  }

  return c.json(
    {
      range,
      since: since.toISOString(),
      step_seconds: stepMs / 1000,
      events: row.events,
      deliveries: { succeeded: row.succeeded, dead: row.dead, pending: row.pending },
      failing_now: row.failing_now,
      dead_in_dlq: row.dead_in_dlq,
      series,
    },
    200,
  );
});
