// Benchmark fairness between tenants. Tenant A sends a big backlog at once; meanwhile
// tenant B sends a trickle, TRICKLE_RATE events a second. Both creating deliveries and sending
// take tenants in turn, so B's events shouldn't wait behind A's backlog. Prints B's dispatch lag
// (event stored → first send) over the run, every 10 s, next to how many of A's deliveries
// finished in that time.
//
// Runs against the running stack (pnpm dev:bench, T1) and test consumer (pnpm consumer, T2).
// Settings: see bench-lib.ts.

import { setTimeout as sleep } from "node:timers/promises";
import {
  api,
  cleanUp,
  connect,
  lagOf,
  ms,
  sendBacklog,
  setUpTenant,
  type Tenant,
  waitForDeliveries,
  waitUntilIdle,
} from "./bench-lib.ts";

const EVENT_TYPE = "bench.fairness";
const BACKLOG = 10_000;
const TRICKLE_RATE = 2;
const BUCKET_S = 10;

const sql = connect();
const run = crypto.randomUUID();
const tenants: Tenant[] = [];
try {
  const a = await setUpTenant(sql, 1, run, EVENT_TYPE);
  tenants.push(a);
  const b = await setUpTenant(sql, 2, run, EVENT_TYPE);
  tenants.push(b);
  await waitUntilIdle(sql);

  // B's trickle runs until A's backlog has been delivered.
  let backlogDone = false;
  const trickle: string[] = [];
  const trickling = (async () => {
    for (let n = 0; !backlogDone; n++) {
      const event = await api<{ id: string }>(b.key, "POST", "/api/events", {
        type: EVENT_TYPE,
        payload: { run, n },
      });
      trickle.push(event.id);
      await sleep(1000 / TRICKLE_RATE);
    }
  })();
  await sleep(2000); // B's lag before A's backlog arrives, for comparison
  const backlog = await sendBacklog(a, EVENT_TYPE, BACKLOG, run);
  await waitForDeliveries(sql, backlog);
  backlogDone = true;
  await trickling;
  await waitForDeliveries(sql, trickle);

  // A's backlog: when it started, and how long it took to deliver.
  const [drain] = await sql<{ start: Date; seconds: number }[]>`
      select min(e.created_at) as start,
             extract(epoch from max(d.finished_at) - min(e.created_at))::float as seconds
      from events e
      join deliveries d on d.event_id = e.id and d.event_created_at = e.created_at
      where e.id = any(${sql.array(backlog)}::uuid[])
    `;
  if (!drain) {
    throw new Error("no backlog found");
  }

  // Per BUCKET_S from the backlog's start: B's lag, and how many of A's deliveries finished.
  const rows = await sql<{ s: number; events: number; med: number; max: number; a_done: number }[]>`
      with b as (
        select e.created_at, extract(epoch from min(att.started_at) - e.created_at) * 1000 as ms
        from events e
        join deliveries d on d.event_id = e.id and d.event_created_at = e.created_at
        join delivery_attempts att on att.delivery_id = d.id
        where e.id = any(${sql.array(trickle)}::uuid[])
        group by e.id, e.created_at
      ),
      buckets as (
        select floor(extract(epoch from created_at - ${drain.start}) / ${BUCKET_S}) * ${BUCKET_S} as s,
               count(*) as events,
               percentile_cont(0.5) within group (order by ms) as med,
               max(ms) as max
        from b group by 1
      ),
      a_done as (
        select floor(extract(epoch from d.finished_at - ${drain.start}) / ${BUCKET_S}) * ${BUCKET_S} as s,
               count(*) as done
        from events e
        join deliveries d on d.event_id = e.id and d.event_created_at = e.created_at
        where e.id = any(${sql.array(backlog)}::uuid[])
        group by 1
      )
      select bu.s::int, bu.events::int, bu.med::float, bu.max::float, coalesce(ad.done, 0)::int as a_done
      from buckets bu left join a_done ad using (s)
      order by bu.s
    `;

  console.log(
    `tenant A: ${backlog.length} events at once, delivered in ${drain.seconds.toFixed(1)} s` +
      ` (${(backlog.length / drain.seconds).toFixed(0)} deliveries/s)`,
  );
  console.log(
    `tenant B: ${trickle.length} events at ${TRICKLE_RATE}/s, lag ${await lagOf(sql, trickle)}`,
  );
  console.log(
    `  (served first in, first out instead, a B event sent just after A's backlog would wait about ${drain.seconds.toFixed(0)} s)\n`,
  );
  console.log("   from A's start   B events   B lag med   B lag max   A delivered");
  for (const row of rows) {
    console.log(
      `${String(row.s).padStart(9)} s ${String(row.events).padStart(13)} ${ms(row.med).padStart(11)}` +
        ` ${ms(row.max).padStart(11)} ${String(row.a_done).padStart(13)}`,
    );
  }
} finally {
  await cleanUp(sql, tenants);
  await sql.end();
}
