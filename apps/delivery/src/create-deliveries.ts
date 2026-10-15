import type { Sql } from "postgres";

export const EVENTS_PER_BATCH = 10;

export type DeliveriesCreated = {
  events: number;
  deliveries: number;
};

// it takes a batch of newly recorded events,
// works out which endpoints should receive each one,
// creates a delivery record and a queue entry for every (event, endpoint) pair,
// flags the affected tenants as having work,
// and marks the events as processed.

export async function createDeliveries(sql: Sql): Promise<DeliveriesCreated> {
  const [result] = await sql<DeliveriesCreated[]>`
      with pending as (
        select id, created_at, tenant_id, type
        from events
        where deliveries_created_at is null
        order by created_at
        limit ${EVENTS_PER_BATCH}
        for update skip locked
      ),
      matched as (
        select distinct p.id as event_id, p.created_at as event_created_at,
                        p.tenant_id, en.id as endpoint_id
        from pending p
        join endpoints en
          on en.tenant_id = p.tenant_id
         and en.state <> 'deleted'
         and en.created_at <= p.created_at
        join endpoint_subscriptions s on s.endpoint_id = en.id
        where s.event_type_pattern = '*'
           or s.event_type_pattern = p.type
           or (s.event_type_pattern like '%.*'
               and starts_with(p.type, left(s.event_type_pattern, -1)))
      ),
      new_deliveries as (
        insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id)
        select tenant_id, event_id, event_created_at, endpoint_id from matched
        returning id, created_at, tenant_id, endpoint_id
      ),
      queued as (
        insert into delivery_queue (delivery_id, delivery_created_at, tenant_id,
  endpoint_id, next_attempt_at)
        select id, created_at, tenant_id, endpoint_id, now() from new_deliveries
        returning tenant_id
      ),
      tenants as (
        insert into tenants_with_work (tenant_id)
        select distinct tenant_id from queued
        on conflict do nothing
      ),
      marked as (
        update events e
        set deliveries_created_at = now()
        from pending p
        where e.id = p.id and e.created_at = p.created_at
        returning e.id
      )
      select (select count(*) from marked)::int as events,
             (select count(*) from new_deliveries)::int as deliveries
    `;

  return result ?? { events: 0, deliveries: 0 };
}
