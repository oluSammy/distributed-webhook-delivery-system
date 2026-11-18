// Benchmark: table bloat under queue churn. A queue in Postgres updates and
// deletes rows all the time; each change leaves a dead row version behind until vacuum removes it,
// and dead rows make the table bigger and every scan slower. This compares two designs, each with
// Postgres's default autovacuum and with the settings delivery_queue uses (vacuum after 1% of rows
// change, no pause between pages):
// - split: what this system does. A small queue table holds only waiting work; a finished row is
//   deleted from it, and its history row (another table) is marked done.
// - single: one table holds every delivery; waiting ones are found through a partial index
//   (where state = 'pending'), and a finished row stays, marked done.
// Each runs the same churn for RUN_MS, ROUNDS_PER_S times a second: claim 100 due rows (as the
// claim does), finish them, add 100 new ones. Every SAMPLE_MS it prints the size of the table the
// claim reads, its dead rows, the claim's latency and how often autovacuum has run. Everything
// happens in a scratch schema, bench_bloat, dropped at the end.
//
// DATABASE_URL    the local database; required

import { setTimeout as sleep } from "node:timers/promises";
import { connect } from "./bench-lib.ts";

const RUN_MS = Number(process.env.WDS_BLOAT_MS ?? 180_000);
const SAMPLE_MS = 15_000;
const WAITING = 10_000; // rows waiting in the queue throughout
const BATCH = 100;
const ROUNDS_PER_S = 20; // 2,000 rows finished a second, the same for every design

const TUNED = "autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 0";

type Design = "split" | "single";

const sql = connect();
const stats = connect(); // a second connection, so sampling doesn't wait behind the churn

// Creates the design's tables, with WAITING rows due now.
async function setUp(design: Design, tuned: boolean) {
  const options = tuned ? `with (${TUNED})` : "";
  await sql.unsafe(`drop schema if exists bench_bloat cascade; create schema bench_bloat`);
  if (design === "split") {
    await sql.unsafe(`
        create table bench_bloat.history (id bigint primary key, state text not null,
          payload text not null, finished_at timestamptz);
        create table bench_bloat.queue (id bigint primary key, next_attempt_at timestamptz not null,
          claim_token uuid) ${options};
        create index on bench_bloat.queue (next_attempt_at);
        create sequence bench_bloat.ids;
        insert into bench_bloat.history select nextval('bench_bloat.ids'), 'pending', repeat('x', 200)
          from generate_series(1, ${WAITING});
        insert into bench_bloat.queue select id, now() from bench_bloat.history;
      `);
  } else {
    await sql.unsafe(`
        create table bench_bloat.queue (id bigint primary key, state text not null,
          next_attempt_at timestamptz not null, claim_token uuid, payload text not null,
          finished_at timestamptz) ${options};
        create index on bench_bloat.queue (next_attempt_at) where state = 'pending';
        create sequence bench_bloat.ids;
        insert into bench_bloat.queue select nextval('bench_bloat.ids'), 'pending', now(), null,
          repeat('x', 200) from generate_series(1, ${WAITING});
      `);
  }
  await sql.unsafe("analyze bench_bloat.queue");
}

// One round: claim BATCH due rows, finish them, add BATCH new ones. Returns the claim's time in ms.
async function round(design: Design): Promise<number> {
  const started = performance.now();
  const claimed = await sql<{ id: string }[]>`
      update bench_bloat.queue q
      set next_attempt_at = now() + interval '90 seconds', claim_token = gen_random_uuid()
      where q.id in (
        select id from bench_bloat.queue
        where next_attempt_at <= now() ${design === "single" ? sql`and state = 'pending'` : sql``}
        order by next_attempt_at
        limit ${BATCH}
        for update skip locked
      )
      returning q.id
    `;
  const claimMs = performance.now() - started;
  const ids = claimed.map((row) => row.id);
  if (design === "split") {
    await sql`delete from bench_bloat.queue where id = any(${sql.array(ids)}::bigint[])`;
    await sql`
        update bench_bloat.history set state = 'succeeded', finished_at = now()
        where id = any(${sql.array(ids)}::bigint[])
      `;
    await sql`
        with new as (
          insert into bench_bloat.history
          select nextval('bench_bloat.ids'), 'pending', repeat('x', 200) from generate_series(1, ${BATCH})
          returning id
        )
        insert into bench_bloat.queue select id, now() from new
      `;
  } else {
    await sql`
        update bench_bloat.queue set state = 'succeeded', finished_at = now(), claim_token = null
        where id = any(${sql.array(ids)}::bigint[])
      `;
    await sql`
        insert into bench_bloat.queue
        select nextval('bench_bloat.ids'), 'pending', now(), null, repeat('x', 200)
        from generate_series(1, ${BATCH})
      `;
  }
  return claimMs;
}

// Size of the table the claim reads (with its indexes), its dead rows, and how often it's been
// autovacuumed.
async function sample() {
  const [row] = await stats<{ mb: number; dead: number; live: number; vacuums: number }[]>`
      select (pg_total_relation_size('bench_bloat.queue') / 1048576.0)::float as mb,
             n_dead_tup::int as dead, n_live_tup::int as live, autovacuum_count::int as vacuums
      from pg_stat_user_tables where schemaname = 'bench_bloat' and relname = 'queue'
    `;
  return row;
}

function percentile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN;
}

try {
  const results: string[] = [];
  for (const design of ["split", "single"] as const) {
    for (const tuned of [false, true]) {
      const label = `${design}, ${tuned ? "tuned" : "default"} autovacuum`;
      await setUp(design, tuned);
      console.log(`\n${label}`);
      console.log(
        "     time    queue MB   dead rows   live rows   claim p50   claim p95    vacuums",
      );
      const started = Date.now();
      let nextSample = started + SAMPLE_MS;
      let window: number[] = [];
      let rounds = 0;
      while (Date.now() - started < RUN_MS) {
        window.push(await round(design));
        rounds++;
        // Keep to ROUNDS_PER_S: wait until this round's slot is over (no wait if behind).
        await sleep(Math.max(0, started + (rounds * 1000) / ROUNDS_PER_S - Date.now()));
        if (Date.now() >= nextSample) {
          window.sort((a, b) => a - b);
          const s = await sample();
          console.log(
            `${String(Math.round((Date.now() - started) / 1000)).padStart(7)} s` +
              `${(s?.mb ?? 0).toFixed(1).padStart(11)}${String(s?.dead).padStart(12)}${String(s?.live).padStart(12)}` +
              `${percentile(window, 0.5).toFixed(1).padStart(9)} ms${percentile(window, 0.95).toFixed(1).padStart(9)} ms` +
              `${String(s?.vacuums).padStart(11)}`,
          );
          window = [];
          nextSample += SAMPLE_MS;
        }
      }
      const end = await sample();
      results.push(
        `${label.padEnd(28)} ${rounds * BATCH} rows finished (target ${(RUN_MS / 1000) * ROUNDS_PER_S * BATCH}); ` +
          "the table the claim reads ends at " +
          `${(end?.mb ?? 0).toFixed(1)} MB, ${end?.vacuums} autovacuums`,
      );
      await sleep(1000);
    }
  }
  console.log(`\n${results.join("\n")}`);
} finally {
  await sql.unsafe("drop schema if exists bench_bloat cascade");
  await sql.end();
  await stats.end();
}
