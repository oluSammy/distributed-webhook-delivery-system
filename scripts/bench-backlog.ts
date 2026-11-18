// Benchmark behaviour with a big backlog. Tenant A gets WDS_BACKLOG deliveries
// (default 1,000,000) queued and due at once, written straight into Postgres: through the API, a
// million events would take this laptop over an hour just to store and create. Then, for
// MEASURE_MS, tenant B sends a trickle through the API while A's backlog is being sent. Reports:
// - how long the backlog took to write, and how big the tables got;
// - tenant B's ingest time and dispatch lag, with a million deliveries ahead of it in the queue;
// - how fast A's backlog goes out while it's that big;
// - how long deleting A's endpoint takes, which cancels everything still queued in one statement.
//
// Runs against the running stack (pnpm dev:bench, T1) and test consumer (pnpm consumer, T2).
// Settings: see bench-lib.ts. The cancelled rows stay in the local database until retention.

import { setTimeout as sleep } from "node:timers/promises";
import {
  api,
  cleanUp,
  connect,
  lagOf,
  setUpTenant,
  type Tenant,
  waitForDeliveries,
  waitUntilIdle,
} from "./bench-lib.ts";

const EVENT_TYPE = "bench.backlog";
const BACKLOG = Number(process.env.WDS_BACKLOG ?? 1_000_000);
const CHUNK = 100_000; // rows written per statement
const MEASURE_MS = 120_000;
const TRICKLE_RATE = 2;

const sql = connect();
const run = crypto.randomUUID();
const tenants: Tenant[] = [];

// The size on disk of a table and its indexes, all partitions included, in MB. pg_partition_tree
// lists a partitioned table's partitions, and nothing for a plain table, so that's counted itself.
async function sizeMb(table: string): Promise<number> {
  const [row] = await sql<{ mb: number }[]>`
      select ((pg_total_relation_size(${table}::regclass)
               + coalesce((select sum(pg_total_relation_size(relid))
                           from pg_partition_tree(${table}::regclass)
                           where relid <> ${table}::regclass), 0)) / 1048576)::float as mb
    `;
  return Math.round(row?.mb ?? 0);
}

// How many of the endpoint's deliveries have succeeded.
async function succeeded(endpointId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
      select count(*)::int from deliveries where endpoint_id = ${endpointId} and state = 'succeeded'
    `;
  return row?.count ?? 0;
}

try {
  const a = await setUpTenant(sql, 1, run, EVENT_TYPE);
  tenants.push(a);
  const b = await setUpTenant(sql, 2, run, EVENT_TYPE);
  tenants.push(b);
  await waitUntilIdle(sql);

  await sql`vacuum delivery_queue`;
  // A's backlog: events whose deliveries are already created, their deliveries, and queue rows due
  // now, as the Creator Worker would have left them.
  const seeding = Date.now();
  for (let written = 0; written < BACKLOG; written += CHUNK) {
    await sql`
        with ev as (
          insert into events (tenant_id, type, payload, deliveries_created_at)
          select ${a.id}::uuid, ${EVENT_TYPE}, '{}'::jsonb, now()
          from generate_series(1, ${Math.min(CHUNK, BACKLOG - written)})
          returning id, created_at
        ),
        d as (
          insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id)
          select ${a.id}::uuid, id, created_at, ${a.endpointId}::uuid from ev
          returning id, created_at
        )
        insert into delivery_queue (delivery_id, delivery_created_at, tenant_id, endpoint_id, next_attempt_at)
        select id, created_at, ${a.id}::uuid, ${a.endpointId}::uuid, now() from d
      `;
  }
  await sql`insert into tenants_with_work (tenant_id) values (${a.id}) on conflict do nothing`;
  await sql`analyze delivery_queue`;
  const seconds = (Date.now() - seeding) / 1000;
  console.log(
    `backlog: ${BACKLOG} queued deliveries written in ${seconds.toFixed(0)} s;` +
      ` delivery_queue ${await sizeMb("delivery_queue")} MB, deliveries ${await sizeMb("deliveries")} MB,` +
      ` events ${await sizeMb("events")} MB`,
  );

  // B's trickle, through the API: each event also wakes the Dispatcher, which starts on A's backlog.
  const before = await succeeded(a.endpointId);
  const trickle: string[] = [];
  const ingestMs: number[] = [];
  const until = Date.now() + MEASURE_MS;
  for (let n = 0; Date.now() < until; n++) {
    const sent = performance.now();
    const event = await api<{ id: string }>(b.key, "POST", "/api/events", {
      type: EVENT_TYPE,
      payload: { run, n },
    });
    ingestMs.push(performance.now() - sent);
    trickle.push(event.id);
    await sleep(1000 / TRICKLE_RATE);
  }
  const sentForA = (await succeeded(a.endpointId)) - before;
  await waitForDeliveries(sql, trickle);

  ingestMs.sort((x, y) => x - y);
  const at = (share: number) =>
    Math.round(ingestMs[Math.floor(ingestMs.length * share)] ?? Number.NaN);
  console.log(
    `tenant B: ${trickle.length} events at ${TRICKLE_RATE}/s; ingest med ${at(0.5)} ms, p99 ${at(0.99)} ms;` +
      ` lag ${await lagOf(sql, trickle)}`,
  );
  console.log(
    `tenant A: ${sentForA} of its backlog delivered in ${MEASURE_MS / 1000} s, ${(sentForA / (MEASURE_MS / 1000)).toFixed(0)} deliveries/s`,
  );

  // Deleting the endpoint cancels its queued deliveries, all in one statement.
  const deleting = Date.now();
  const deleted = await api<{ cancelled_deliveries: number }>(
    a.key,
    "DELETE",
    `/api/endpoints/${a.endpointId}`,
  );
  console.log(
    `deleting A's endpoint: ${deleted.cancelled_deliveries} deliveries cancelled in ${((Date.now() - deleting) / 1000).toFixed(1)} s`,
  );
} finally {
  await cleanUp(sql, tenants);
  await sql.end();
}
