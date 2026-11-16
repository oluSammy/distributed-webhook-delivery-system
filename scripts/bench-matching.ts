// Benchmark events that match 1, 100 and 1,000 endpoints. For each size it measures
// - ingest: how long POST /api/events takes. Deliveries are created later, by the Creator Worker,
//   so this should not grow with the number of endpoints;
// - creating deliveries: from the event being stored to its deliveries being created
//   (events.deliveries_created_at - created_at);
// - sending: from the first event to the last of its deliveries succeeding, and deliveries/s.
//
// Runs against the running stack (pnpm dev:bench, T1) and test consumer (pnpm consumer, T2).
//
// WDS_SMOKE_KEY   the Smoke tenant's API key (printed by pnpm seed); required
// DATABASE_URL    the local database; required
// WDS_API_URL     default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000

import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";

const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const API_KEY = process.env.WDS_SMOKE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const TIMEOUT_MS = 15 * 60_000;

// Endpoints per event, and how many events: about 5,000 deliveries at most per size, so the
// sending part stays a few minutes on a laptop.
const SIZES = [
  { endpoints: 1, events: 200 },
  { endpoints: 100, events: 20 },
  { endpoints: 1000, events: 5 },
];

if (!API_KEY || !DATABASE_URL) {
  console.error("Set WDS_SMOKE_KEY and DATABASE_URL (both are in .env after pnpm seed)");
  process.exit(1);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

// Waits until the system is idle: no stored events waiting for their deliveries to be created, and
// nothing due in the queue. Otherwise leftovers from earlier runs are timed along with this one.
async function waitUntilIdle(sql: postgres.Sql) {
  for (;;) {
    const [busy] = await sql<{ waiting: number; due: number }[]>`
        select (select count(*) from events where deliveries_created_at is null)::int as waiting,
               (select count(*) from delivery_queue where next_attempt_at <= now())::int as due
      `;
    if (busy?.waiting === 0 && busy.due === 0) {
      return;
    }
    console.log(`waiting for earlier work: ${busy?.waiting} events, ${busy?.due} deliveries due`);
    await sleep(5000);
  }
}

// The value below which the given share of the sorted numbers fall (0.5: median, 0.99: p99).
function percentile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN;
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const [tenant] = await sql<{ id: string }[]>`
    select tenant_id as id from api_keys
    where key_hash = sha256(convert_to(${API_KEY}, 'UTF8')) and scope = 'tenant'
  `;
if (!tenant) {
  console.error("WDS_SMOKE_KEY doesn't match a tenant key");
  process.exit(1);
}

const endpointIds: string[] = [];
try {
  for (const size of SIZES) {
    // Its own event type per size, so each size's endpoints get only its events.
    const type = `bench.match${size.endpoints}`;
    await sql`
        insert into event_types (tenant_id, name) values (${tenant.id}, ${type})
        on conflict do nothing
      `;
    const run = crypto.randomUUID();
    const ours: string[] = [];
    for (let n = 0; n < size.endpoints; n++) {
      const endpoint = await api<{ id: string }>("POST", "/api/endpoints", {
        url: new URL(`/ok?run=${run}&n=${n}`, CONSUMER_URL).toString(),
        description: `bench ${size.endpoints}`,
        subscriptions: [type],
      });
      ours.push(endpoint.id);
    }
    endpointIds.push(...ours);

    await waitUntilIdle(sql);

    // One event at a time, so each POST's time is the API Worker's alone.
    const started = Date.now();
    const ingestMs: number[] = [];
    const eventIds: string[] = [];
    for (let n = 0; n < size.events; n++) {
      const before = performance.now();
      const event = await api<{ id: string }>("POST", "/api/events", { type, payload: { run, n } });
      ingestMs.push(performance.now() - before);
      eventIds.push(event.id);
    }

    // Waits until every delivery of these events has finished.
    const expected = size.endpoints * size.events;
    for (;;) {
      const [row] = await sql<{ finished: number }[]>`
          select count(*)::int as finished from deliveries
          where event_id = any(${sql.array(eventIds)}::uuid[]) and state <> 'pending'
        `;
      if ((row?.finished ?? 0) >= expected || Date.now() - started > TIMEOUT_MS) {
        break;
      }
      await sleep(1000);
    }

    const [timing] = await sql<
      {
        created_med: number;
        created_p95: number;
        created_max: number;
        deliveries: number;
        succeeded: number;
        sent_s: number;
      }[]
    >`
        with ev as (
          select id, created_at, deliveries_created_at from events
          where id = any(${sql.array(eventIds)}::uuid[])
        ),
        lag as (
          select extract(epoch from deliveries_created_at - created_at) * 1000 as ms from ev
        ),
        d as (
          select d.state, d.finished_at from deliveries d
          join ev on d.event_id = ev.id and d.event_created_at = ev.created_at
        )
        select (select percentile_cont(0.5) within group (order by ms) from lag)::float as created_med,
               (select percentile_cont(0.95) within group (order by ms) from lag)::float as created_p95,
               (select max(ms) from lag)::float as created_max,
               (select count(*) from d)::int as deliveries,
               (select count(*) from d where state = 'succeeded')::int as succeeded,
               extract(epoch from (select max(finished_at) from d) - (select min(created_at) from ev))::float as sent_s
      `;
    ingestMs.sort((a, b) => a - b);
    const ms = (value: number | undefined) => `${Math.round(value ?? Number.NaN)} ms`;
    console.log(`\n${size.endpoints} matching endpoint(s), ${size.events} events:`);
    console.log(
      `  ingest            med ${ms(percentile(ingestMs, 0.5))}, p99 ${ms(percentile(ingestMs, 0.99))}`,
    );
    console.log(
      `  create deliveries med ${ms(timing?.created_med)}, p95 ${ms(timing?.created_p95)}, max ${ms(timing?.created_max)}`,
    );
    console.log(
      `  send              ${timing?.succeeded} of ${expected} succeeded (${timing?.deliveries} created)` +
        ` in ${timing?.sent_s.toFixed(1)} s, ${((timing?.succeeded ?? 0) / (timing?.sent_s ?? 1)).toFixed(0)} deliveries/s`,
    );
  }
} finally {
  // Deleting endpoints with nothing waiting is quick; this also stops them matching later runs.
  for (const id of endpointIds) {
    await api("DELETE", `/api/endpoints/${id}`).catch(() => {});
  }
  await sql.end();
}
