import { firstRow } from "@wds/core";
import { createDb } from "@wds/db";
import type { Sql } from "postgres";

// A database of its own, next to the dev one, so tests can empty it freely. CI sets the variable.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://webhooks:webhooks@localhost:5433/webhooks_test";

export function connect(): Sql {
  return createDb(TEST_DATABASE_URL);
}

// Empties every table and clears the global pause, so each test starts from nothing.
export async function reset(sql: Sql): Promise<void> {
  await sql`
      truncate tenants, api_keys, event_types, endpoints, endpoint_subscriptions, endpoint_secrets,
        events, idempotency_keys, deliveries, delivery_attempts, dead_delivery_attempts,
        delivery_queue, tenants_with_work, notifications
      restart identity cascade
    `;
  await sql`update global_settings set paused = false`;
}

export async function makeTenant(sql: Sql, paused = false): Promise<string> {
  const { id } = firstRow(
    await sql<{ id: string }[]>`
        insert into tenants (name, paused) values ('test', ${paused}) returning id
      `,
  );
  return id;
}

export async function makeEndpoint(
  sql: Sql,
  tenantId: string,
  state: "active" | "paused" | "disabled" = "active",
): Promise<string> {
  const probeAt = state === "disabled" ? new Date(Date.now() + 60_000) : null;
  const { id } = firstRow(
    await sql<{ id: string }[]>`
        insert into endpoints (tenant_id, url, state, probe_at)
        values (${tenantId}, 'https://example.com/hook', ${state}, ${probeAt})
        returning id
      `,
  );
  return id;
}

// One event and its pending delivery to the endpoint, queued and due now (or parked), as creating
// deliveries would leave them. Returns the delivery's id.
export async function makeDelivery(
  sql: Sql,
  tenantId: string,
  endpointId: string,
  parked = false,
): Promise<string> {
  const { id } = firstRow(
    await sql<{ id: string }[]>`
        with event as (
          insert into events (tenant_id, type, payload, deliveries_created_at)
          values (${tenantId}, 'test.event', '{}', now())
          returning id, created_at
        ),
        delivery as (
          insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id)
          select ${tenantId}::uuid, id, created_at, ${endpointId}::uuid from event
          returning id, created_at
        ),
        queued as (
          insert into delivery_queue (delivery_id, delivery_created_at, tenant_id, endpoint_id, next_attempt_at)
          select id, created_at, ${tenantId}::uuid, ${endpointId}::uuid,
                 ${parked ? sql`'infinity'::timestamptz` : sql`now()`}
          from delivery
        ),
        work as (
          insert into tenants_with_work (tenant_id) values (${tenantId}) on conflict do nothing
        )
        select id from delivery
      `,
  );
  return id;
}

// A delivery's queue row: whether it's parked, due now, or claimed. null once it has left the
// queue.
export async function queueRow(
  sql: Sql,
  deliveryId: string,
): Promise<{ parked: boolean; due: boolean; claimed: boolean } | null> {
  const [row] = await sql<{ parked: boolean; due: boolean; claimed: boolean }[]>`
      select next_attempt_at = 'infinity' as parked, next_attempt_at <= now() as due,
             claim_token is not null as claimed
      from delivery_queue where delivery_id = ${deliveryId}
    `;
  return row ?? null;
}
