import type { Sql } from "postgres";

type Gauge = {
  name: string;
  help: string;
  samples: { labels?: Record<string, string>; value: number }[];
};

type Row = {
  due: number;
  scheduled: number;
  claimed: number;
  stale: number;
  parked: number;
  oldest_due_s: number;
  events_waiting: number;
  oldest_event_s: number;
  dlq: number;
  active: number;
  paused: number;
  disabled: number;
  success: number;
  failure: number;
  throttled: number;
  non_retryable: number;
  global_paused: boolean;
  tenants_paused: number;
};

export async function collectMetrics(sql: Sql): Promise<string> {
  const [row] = await sql<Row[]>`
        with queue as (
          select
            count(*) filter (where claim_token is null and next_attempt_at <= now()) as due,
            count(*) filter (where claim_token is null and next_attempt_at > now()
                               and next_attempt_at < 'infinity') as scheduled,
            count(*) filter (where claim_token is not null and next_attempt_at > now()) as claimed,
            count(*) filter (where claim_token is not null and next_attempt_at <= now()) as stale,
            count(*) filter (where next_attempt_at = 'infinity') as parked,
            extract(epoch from now() - min(next_attempt_at)
                    filter (where claim_token is null and next_attempt_at <= now())) as oldest_due_s
          from delivery_queue
        ),
        waiting as (
          select count(*) as events, extract(epoch from now() - min(created_at)) as oldest_s
          from events where deliveries_created_at is null
        ),
        attempts as (
          select count(*) filter (where outcome = 'success') as success,
                 count(*) filter (where outcome = 'failure') as failure,
                 count(*) filter (where outcome = 'throttled') as throttled,
                 count(*) filter (where outcome = 'non_retryable') as non_retryable
          from delivery_attempts
          where started_at > now() - interval '5 minutes' and not stale
        ),
        endpoint_states as (
          select count(*) filter (where state = 'active') as active,
                 count(*) filter (where state = 'paused') as paused,
                 count(*) filter (where state = 'disabled') as disabled
          from endpoints
        )
        select q.due::int, q.scheduled::int, q.claimed::int, q.stale::int, q.parked::int,
               coalesce(q.oldest_due_s, 0)::float as oldest_due_s,
               w.events::int as events_waiting, coalesce(w.oldest_s, 0)::float as oldest_event_s,
               (select count(*) from deliveries where state = 'dead' and resolution is null)::int as dlq,
               e.active::int, e.paused::int, e.disabled::int,
               a.success::int, a.failure::int, a.throttled::int, a.non_retryable::int,
               (select paused from global_settings) as global_paused,
               (select count(*) from tenants where paused)::int as tenants_paused
        from queue q, waiting w, attempts a, endpoint_states e
      `;
  if (!row) {
    throw new Error("metrics query returned no row");
  }
  return format([
    {
      name: "webhook_queue_deliveries",
      help: "Deliveries in the queue, by status: due now, scheduled for later, claimed by a Delivery Worker, claimed but the lease has run out (stale), parked (paused or breaker open).",
      samples: [
        { labels: { status: "due" }, value: row.due },
        { labels: { status: "scheduled" }, value: row.scheduled },
        { labels: { status: "claimed" }, value: row.claimed },
        { labels: { status: "stale" }, value: row.stale },
        { labels: { status: "parked" }, value: row.parked },
      ],
    },
    {
      name: "webhook_queue_oldest_due_seconds",
      help: "How long the oldest due, unclaimed delivery has been waiting to be sent. 0 when none is.",
      samples: [{ value: row.oldest_due_s }],
    },
    {
      name: "webhook_events_waiting",
      help: "Stored events whose deliveries haven't been created yet.",
      samples: [{ value: row.events_waiting }],
    },
    {
      name: "webhook_events_oldest_waiting_seconds",
      help: "How long the oldest of those events has been waiting. 0 when none is.",
      samples: [{ value: row.oldest_event_s }],
    },
    {
      name: "webhook_dlq_deliveries",
      help: "Dead deliveries still in the DLQ (neither redelivered nor discarded).",
      samples: [{ value: row.dlq }],
    },
    {
      name: "webhook_endpoints",
      help: "Endpoints by state (deleted ones left out). disabled: the circuit breaker tripped.",
      samples: [
        { labels: { state: "active" }, value: row.active },
        { labels: { state: "paused" }, value: row.paused },
        { labels: { state: "disabled" }, value: row.disabled },
      ],
    },
    {
      name: "webhook_attempts_5m",
      help: "Attempts started in the last 5 minutes whose outcome was recorded, by outcome.",
      samples: [
        { labels: { outcome: "success" }, value: row.success },
        { labels: { outcome: "failure" }, value: row.failure },
        { labels: { outcome: "throttled" }, value: row.throttled },
        { labels: { outcome: "non_retryable" }, value: row.non_retryable },
      ],
    },
    {
      name: "webhook_paused",
      help: "1 while everything is paused (POST /admin/pause), otherwise 0.",
      samples: [{ value: row.global_paused ? 1 : 0 }],
    },
    {
      name: "webhook_tenants_paused",
      help: "Tenants paused by an operator.",
      samples: [{ value: row.tenants_paused }],
    },
  ]);
}

// Prometheus's text format: for each metric a # HELP and a # TYPE line, then one line per sample,
// name{label="value"} number.
function format(gauges: Gauge[]): string {
  const lines: string[] = [];
  for (const gauge of gauges) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`, `# TYPE ${gauge.name} gauge`);
    for (const sample of gauge.samples) {
      const labels = Object.entries(sample.labels ?? {})
        .map(([key, value]) => `${key}="${value}"`)
        .join(",");
      lines.push(`${gauge.name}${labels ? `{${labels}}` : ""} ${sample.value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
