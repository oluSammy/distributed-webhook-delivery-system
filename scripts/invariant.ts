// Invariant test sends 10,000 events to one endpoint that fails 30% of the time,
// waits until every delivery has finished, then checks the invariant with SQL:
// 1. Every accepted event has its deliveries created exactly once.
// 2. Every delivery reaches exactly one terminal state (succeeded or dead), and stays there.
// 3. Only the current claim holder changes a delivery: its counters and final state match the
//    attempts written by holders whose write applied (stale = false).
//
// Runs against the running local stack (pnpm dev, T1) and test consumer (pnpm consumer, T2).
// Exits with 1 when any check fails.
//
// WDS_SMOKE_KEY   the Smoke tenant's API key (printed by pnpm seed); required
// DATABASE_URL    the local database; required
// WDS_API_URL     default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000
// WDS_EVENTS      how many events, default 10000

import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";

const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const API_KEY = process.env.WDS_SMOKE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const EVENTS = Number(process.env.WDS_EVENTS ?? 10_000);
const EVENT_TYPE = "invariant.test";
const BATCH = 500; // the most POST /api/events/batch takes
const FAILURE_RATE = 0.3;
const TIMEOUT_MS = 20 * 60_000;

if (!API_KEY || !DATABASE_URL) {
  console.error("Set WDS_SMOKE_KEY and DATABASE_URL (both are in .env after pnpm seed)");
  process.exit(1);
}

let failures = 0;
function check(passed: boolean, label: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) {
    failures++;
  }
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

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const [tenant] = await sql<{ id: string; max_attempts: number }[]>`
    select t.id, coalesce((t.retry_policy ->> 'max_attempts')::int, 10) as max_attempts
    from api_keys k join tenants t on t.id = k.tenant_id
    where k.key_hash = sha256(convert_to(${API_KEY}, 'UTF8')) and k.scope = 'tenant'
  `;
if (!tenant) {
  console.error("WDS_SMOKE_KEY doesn't match a tenant key");
  process.exit(1);
}
// Its own event type keeps endpoints from other runs out, and this run's endpoint out of theirs.
await sql`
    insert into event_types (tenant_id, name) values (${tenant.id}, ${EVENT_TYPE})
    on conflict do nothing
  `;

const run = crypto.randomUUID();
// Limits high enough that the endpoint's limiter isn't what this run measures.
const endpoint = await api<{ id: string }>("POST", "/api/endpoints", {
  url: new URL(`/fail-rate?p=${FAILURE_RATE}&run=${run}`, CONSUMER_URL).toString(),
  description: "invariant",
  subscriptions: [EVENT_TYPE],
  rate_limit_per_s: 1000,
  concurrency_limit: 50,
});

try {
  console.log(`invariant run ${run}: ${EVENTS} events, ${FAILURE_RATE * 100}% of sends fail`);
  const started = Date.now();
  const accepted: string[] = [];
  for (let sent = 0; sent < EVENTS; sent += BATCH) {
    const count = Math.min(BATCH, EVENTS - sent);
    const { events } = await api<{ events: { id: string }[] }>("POST", "/api/events/batch", {
      events: Array.from({ length: count }, (_, i) => ({
        type: EVENT_TYPE,
        payload: { run, n: sent + i },
      })),
    });
    accepted.push(...events.map((event) => event.id));
  }
  console.log(
    `${accepted.length} events accepted in ${Math.round((Date.now() - started) / 1000)} s`,
  );

  // Waits until the endpoint has no queue rows left and every event has its deliveries created.
  for (;;) {
    const [left] = await sql<{ queued: number; uncreated: number; finished: number }[]>`
        select (select count(*) from delivery_queue where endpoint_id = ${endpoint.id})::int as queued,
               (select count(*) from events
                where id = any(${sql.array(accepted)}::uuid[]) and deliveries_created_at is null
               )::int as uncreated,
               (select count(*) from deliveries
                where endpoint_id = ${endpoint.id} and state <> 'pending')::int as finished
      `;
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(
      `${elapsed} s: ${left?.finished} finished, ${left?.queued} queued, ${left?.uncreated} events waiting`,
    );
    if (left?.queued === 0 && left.uncreated === 0) {
      break;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      console.log("timed out; checking what's there");
      break;
    }
    await sleep(10_000);
  }
  console.log("");

  // Rule 1: stored, and deliveries created exactly once. Each event matches this one endpoint
  // only, so it must have exactly one delivery.
  const [created] = await sql<{ stored: number; uncreated: number; not_one: number }[]>`
      with ours as (
        select e.id, e.created_at, e.deliveries_created_at from events e
        where e.id = any(${sql.array(accepted)}::uuid[])
      ),
      per_event as (
        select o.id, count(d.id) as deliveries
        from ours o
        left join deliveries d on d.event_id = o.id and d.event_created_at = o.created_at
        group by o.id
      )
      select (select count(*) from ours)::int as stored,
             (select count(*) from ours where deliveries_created_at is null)::int as uncreated,
             (select count(*) from per_event where deliveries <> 1)::int as not_one
    `;
  check(
    created?.stored === accepted.length,
    `${created?.stored} of ${accepted.length} accepted events stored`,
  );
  check(created?.uncreated === 0, `${created?.uncreated} events without their deliveries created`);
  check(created?.not_one === 0, `${created?.not_one} events with other than exactly one delivery`);

  // Rule 2: one terminal state each, finished, and nothing left in the queue.
  const [ends] = await sql<
    { succeeded: number; dead: number; other: number; unfinished: number; queued: number }[]
  >`
      select count(*) filter (where state = 'succeeded')::int as succeeded,
             count(*) filter (where state = 'dead')::int as dead,
             count(*) filter (where state not in ('succeeded', 'dead'))::int as other,
             count(*) filter (where finished_at is null)::int as unfinished,
             (select count(*) from delivery_queue where endpoint_id = ${endpoint.id})::int as queued
      from deliveries where endpoint_id = ${endpoint.id}
    `;
  check(ends?.other === 0, `${ends?.other} deliveries not succeeded or dead`);
  check(ends?.unfinished === 0, `${ends?.unfinished} deliveries without finished_at`);
  check(ends?.queued === 0, `${ends?.queued} queue rows left`);

  // Rule 3: the state matches the history written by holders whose write applied. Per delivery,
  // over its non-stale attempts:
  // - their numbers are 1, 2, 3… with no gaps or repeats (one write per claim);
  // - attempt_count equals the failures among them (no failure counted twice, none lost);
  // - succeeded: exactly one success, and it's the last attempt;
  // - dead: max_attempts failures, the last one a failure, and failure_reason max_attempts;
  // - none started after the delivery finished.
  const [history] = await sql<
    {
      numbering: number;
      counted: number;
      bad_success: number;
      bad_dead: number;
      after_finish: number;
      attempts: number;
      stale: number;
    }[]
  >`
      with d as (
        select id, state, attempt_count, failure_reason, finished_at
        from deliveries where endpoint_id = ${endpoint.id}
      ),
      a as (
        select a.delivery_id, a.attempt_number, a.outcome, a.stale, a.started_at,
               row_number() over (partition by a.delivery_id, a.stale order by a.attempt_number desc) as from_last
        from delivery_attempts a join d on d.id = a.delivery_id
      ),
      per as (
        select d.id, d.state, d.attempt_count, d.failure_reason, d.finished_at,
               count(a.*) filter (where not a.stale) as applied,
               count(distinct a.attempt_number) filter (where not a.stale) as distinct_numbers,
               max(a.attempt_number) filter (where not a.stale) as last_number,
               count(*) filter (where not a.stale and a.outcome = 'failure') as failed,
               count(*) filter (where not a.stale and a.outcome = 'success') as succeeded,
               max(a.outcome) filter (where not a.stale and a.from_last = 1) as last_outcome,
               count(*) filter (where not a.stale and a.started_at > d.finished_at) as after_finish
        from d left join a on a.delivery_id = d.id
        group by d.id, d.state, d.attempt_count, d.failure_reason, d.finished_at
      )
      select count(*) filter (where applied <> distinct_numbers or last_number <> applied)::int as numbering,
             count(*) filter (where attempt_count <> failed)::int as counted,
             count(*) filter (where state = 'succeeded'
               and (succeeded <> 1 or last_outcome <> 'success'))::int as bad_success,
             count(*) filter (where state = 'dead'
               and (failed <> ${tenant.max_attempts} or last_outcome <> 'failure'
                    or failure_reason <> 'max_attempts' or succeeded > 0))::int as bad_dead,
             count(*) filter (where after_finish > 0)::int as after_finish,
             (select count(*) from a where not stale)::int as attempts,
             (select count(*) from a where stale)::int as stale
      from per
    `;
  check(
    history?.numbering === 0,
    `${history?.numbering} deliveries with gaps or repeats in attempt numbers`,
  );
  check(
    history?.counted === 0,
    `${history?.counted} deliveries whose attempt_count doesn't match their failures`,
  );
  check(
    history?.bad_success === 0,
    `${history?.bad_success} succeeded deliveries without exactly one, final, success`,
  );
  check(
    history?.bad_dead === 0,
    `${history?.bad_dead} dead deliveries without ${tenant.max_attempts} failures`,
  );
  check(
    history?.after_finish === 0,
    `${history?.after_finish} deliveries with an attempt after they finished`,
  );

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `\n${ends?.succeeded} succeeded, ${ends?.dead} dead (${tenant.max_attempts} failures in a row),` +
      ` ${history?.attempts} attempts, ${history?.stale} stale, in ${minutes} min`,
  );
} finally {
  await api("DELETE", `/api/endpoints/${endpoint.id}`).catch(() => {});
  await sql.end();
}

console.log(failures === 0 ? "\ninvariant passed" : `\ninvariant FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
