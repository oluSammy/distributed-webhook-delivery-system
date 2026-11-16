// Shared by the benchmarks that make their own tenants (bench-dispatch.ts, bench-fairness.ts).
//
// DATABASE_URL    the local database; required
// WDS_API_URL     default http://localhost:8787
// WDS_CONSUMER_URL  default http://localhost:4000

import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";

export const API_URL = process.env.WDS_API_URL ?? "http://localhost:8787";
export const CONSUMER_URL = process.env.WDS_CONSUMER_URL ?? "http://localhost:4000";
const TIMEOUT_MS = 20 * 60_000;

export function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL (it's in .env)");
    process.exit(1);
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}

export async function api<T>(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

// Bench tenants "Bench 1"… are made once and kept. Each run gives each a fresh API key (revoked by
// cleanUp) and an endpoint at /ok with limits high enough not to be what's measured.
export type Tenant = { id: string; key: string; endpointId: string };
export async function setUpTenant(
  sql: postgres.Sql,
  n: number,
  run: string,
  eventType: string,
): Promise<Tenant> {
  const name = `Bench ${n}`;
  const [existing] = await sql<{ id: string }[]>`select id from tenants where name = ${name}`;
  const id =
    existing?.id ??
    (await sql<{ id: string }[]>`insert into tenants (name) values (${name}) returning id`)[0]?.id;
  if (!id) {
    throw new Error(`could not create tenant ${name}`);
  }
  await sql`
      insert into event_types (tenant_id, name) values (${id}, ${eventType})
      on conflict do nothing
    `;
  const key = `whk_live_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  await sql`
      insert into api_keys (tenant_id, scope, key_prefix, key_hash)
      values (${id}, 'tenant', left(${key}, 13), sha256(convert_to(${key}, 'UTF8')))
    `;
  const endpoint = await api<{ id: string }>(key, "POST", "/api/endpoints", {
    url: new URL(`/ok?run=${run}&tenant=${n}`, CONSUMER_URL).toString(),
    description: "bench",
    subscriptions: [eventType],
    rate_limit_per_s: 1000,
    concurrency_limit: 50,
  });
  return { id, key, endpointId: endpoint.id };
}

// Deletes each tenant's endpoint and revokes its key.
export async function cleanUp(sql: postgres.Sql, tenants: Tenant[]) {
  for (const tenant of tenants) {
    await api(tenant.key, "DELETE", `/api/endpoints/${tenant.endpointId}`).catch(() => {});
    await sql`
        update api_keys set revoked_at = now()
        where key_hash = sha256(convert_to(${tenant.key}, 'UTF8'))
      `;
  }
}

// Sends count events for the tenant, in batches of 500 (the most one batch takes). Returns their ids.
export async function sendBacklog(
  tenant: Tenant,
  eventType: string,
  count: number,
  run: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let sent = 0; sent < count; sent += 500) {
    const { events } = await api<{ events: { id: string }[] }>(
      tenant.key,
      "POST",
      "/api/events/batch",
      {
        events: Array.from({ length: Math.min(500, count - sent) }, (_, n) => ({
          type: eventType,
          payload: { run, n: sent + n },
        })),
      },
    );
    ids.push(...events.map((event) => event.id));
  }
  return ids;
}

// Waits until the system is idle: no stored events waiting for their deliveries to be created, and
// nothing due in the queue. Otherwise leftovers from earlier runs are timed along with this one.
export async function waitUntilIdle(sql: postgres.Sql) {
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

// Waits until every one of these events has its deliveries created, and every delivery has finished.
export async function waitForDeliveries(sql: postgres.Sql, eventIds: string[]) {
  const started = Date.now();
  for (;;) {
    const [row] = await sql<{ uncreated: number; pending: number }[]>`
        select (select count(*) from events
                where id = any(${sql.array(eventIds)}::uuid[]) and deliveries_created_at is null
               )::int as uncreated,
               (select count(*) from deliveries
                where event_id = any(${sql.array(eventIds)}::uuid[]) and state = 'pending'
               )::int as pending
      `;
    if ((row?.uncreated === 0 && row.pending === 0) || Date.now() - started > TIMEOUT_MS) {
      return;
    }
    await sleep(1000);
  }
}

// From each event being stored to its delivery's first send starting, as "med …, p95 …, max …".
export async function lagOf(sql: postgres.Sql, eventIds: string[]): Promise<string> {
  const [row] = await sql<{ med: number; p95: number; max: number }[]>`
      with lag as (
        select extract(epoch from min(a.started_at) - e.created_at) * 1000 as ms
        from events e
        join deliveries d on d.event_id = e.id and d.event_created_at = e.created_at
        join delivery_attempts a on a.delivery_id = d.id
        where e.id = any(${sql.array(eventIds)}::uuid[])
        group by e.id, e.created_at
      )
      select percentile_cont(0.5) within group (order by ms)::float as med,
             percentile_cont(0.95) within group (order by ms)::float as p95,
             max(ms)::float as max
      from lag
    `;
  return `med ${ms(row?.med)}, p95 ${ms(row?.p95)}, max ${ms(row?.max)}`;
}

export function ms(value: number | undefined): string {
  return `${Math.round(value ?? Number.NaN)} ms`;
}
