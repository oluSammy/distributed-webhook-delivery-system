// Benchmark: how fast deliveries go out, and how long a new event waits to be sent.
// 1. Dispatch lag with the wake-up: events sent through the API at a steady rate. Each one wakes
//    the Dispatcher; lag is from the event being stored to its first send starting.
// 2. Dispatch lag without the wake-up: the same events written straight into Postgres, as if every
//    wake-up were lost. An idle Dispatcher doesn't see them until something wakes it: in the cloud
//    the maintenance cron, every 15 minutes. Here the script runs the cron by hand after CRON_AFTER_MS.
// 3. Throughput: a backlog of deliveries from several tenants at once, and deliveries/s.
//
// The Dispatcher starts DELIVERY_CALLS Delivery Worker runs per tick (1 to 6). Set it in
// apps/dispatcher/.dev.vars and restart pnpm dev:bench before each run, to compare 1, 2, 4 and 6.
//
// Runs against the running stack (pnpm dev:bench, T1) and test consumer (pnpm consumer, T2).
// Settings: see bench-lib.ts.

import { setTimeout as sleep } from "node:timers/promises";
import {
  API_URL,
  api,
  cleanUp,
  connect,
  lagOf,
  sendBacklog,
  setUpTenant,
  type Tenant,
  waitForDeliveries,
  waitUntilIdle,
} from "./bench-lib.ts";

const EVENT_TYPE = "bench.dispatch";
const LAG_EVENTS = 200; // sent at LAG_RATE per second
const LAG_RATE = 10;
const CRON_AFTER_MS = 60_000;
const TENANTS = 4; // the claim takes at most 5 per tenant, so one tenant can't fill a batch of 10
const BACKLOG_PER_TENANT = 2000;

const sql = connect();
const run = crypto.randomUUID();
const tenants: Tenant[] = [];
try {
  for (let n = 1; n <= TENANTS; n++) {
    tenants.push(await setUpTenant(sql, n, run, EVENT_TYPE));
  }
  const [first] = tenants;
  if (!first) {
    throw new Error("no tenants");
  }

  await waitUntilIdle(sql);

  // 1. With the wake-up.
  const woken: string[] = [];
  for (let n = 0; n < LAG_EVENTS; n++) {
    const event = await api<{ id: string }>(first.key, "POST", "/api/events", {
      type: EVENT_TYPE,
      payload: { run, n },
    });
    woken.push(event.id);
    await sleep(1000 / LAG_RATE);
  }
  await waitForDeliveries(sql, woken);
  console.log(`dispatch lag, with the wake-up:    ${await lagOf(sql, woken)}`);

  // 2. Without it: stored straight into Postgres as the API Worker stores them (the event, and its
  // tenant in tenants_with_events), but no wake-up is sent.
  const unwoken: string[] = [];
  for (let n = 0; n < LAG_EVENTS; n++) {
    const [event] = await sql<{ id: string }[]>`
        with inserted as (
          insert into events (tenant_id, type, payload)
          values (${first.id}, ${EVENT_TYPE}, ${sql.json({ run, n })})
          returning id
        ),
        waiting as (
          insert into tenants_with_events (tenant_id) values (${first.id}) on conflict do nothing
        )
        select id from inserted
      `;
    if (event) {
      unwoken.push(event.id);
    }
    await sleep(1000 / LAG_RATE);
  }
  await sleep(CRON_AFTER_MS - (LAG_EVENTS * 1000) / LAG_RATE);
  const [before] = await sql<{ created: number }[]>`
      select count(*)::int as created from events
      where id = any(${sql.array(unwoken)}::uuid[]) and deliveries_created_at is not null
    `;
  await fetch(`${API_URL}/__scheduled?cron=*/15+*+*+*+*`);
  await waitForDeliveries(sql, unwoken);
  console.log(`dispatch lag, without the wake-up: ${await lagOf(sql, unwoken)}`);
  console.log(
    `  (${before?.created} of ${LAG_EVENTS} had their deliveries created before the cron ran at ${CRON_AFTER_MS / 1000} s)`,
  );

  // 3. Throughput: every tenant's backlog at once.
  await waitUntilIdle(sql);
  const backlog = (
    await Promise.all(
      tenants.map((tenant) => sendBacklog(tenant, EVENT_TYPE, BACKLOG_PER_TENANT, run)),
    )
  ).flat();
  await waitForDeliveries(sql, backlog);
  const [rate] = await sql<{ delivered: number; seconds: number }[]>`
      with ev as (
        select id, created_at from events where id = any(${sql.array(backlog)}::uuid[])
      ),
      d as (
        select d.id from deliveries d join ev on d.event_id = ev.id and d.event_created_at = ev.created_at
        where d.state = 'succeeded'
      ),
      a as (
        select a.started_at, a.finished_at from delivery_attempts a join d on d.id = a.delivery_id
      )
      select (select count(*) from d)::int as delivered,
             extract(epoch from (select max(finished_at) from a) - (select min(started_at) from a))::float as seconds
    `;
  console.log(
    `throughput: ${rate?.delivered} deliveries from ${TENANTS} tenants in ${rate?.seconds.toFixed(1)} s,` +
      ` ${((rate?.delivered ?? 0) / (rate?.seconds ?? 1)).toFixed(0)} deliveries/s`,
  );
} finally {
  await cleanUp(sql, tenants);
  await sql.end();
}
