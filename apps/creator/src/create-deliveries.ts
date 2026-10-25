import type { Sql } from "postgres";

export const EVENTS_PER_BATCH = 20;

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
        insert into delivery_queue (delivery_id, delivery_created_at, tenant_id, endpoint_id, next_attempt_at)
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



/**
 * 1. pending: take a batch - for update skip locked
 * It takes the oldest 20 unprocessed events. The partial index idx_events_pending_fanout only contains
    these rows, so the lookup stays fast however big events gets.

    for update skip locked locks the rows it takes. If a second create runs at the same time, it skips the
    locked rows instead of waiting for them or processing them twice.


    2. matched: work out who receives each event
    An endpoint receives an event when all of these hold:
  - Same tenant
  - state <> 'deleted'. Paused and disabled endpoints do still get deliveries created; this is presumably so
    they can be sent on resume, though the pause and resume logic isn't built yet.
  - en.created_at <= p.created_at: the endpoint already existed when the event happened. An endpoint you
    register today doesn't receive yesterday's backlog.
  - A subscription matches:
    - * → everything
    - exact → order.paid
    - prefix → order.* matches order.paid and order.payment.refunded, but not orderx.created. That's why the
      check is starts_with(type, 'order.') with the trailing dot kept. It's starts_with and not LIKE
      because _ is a wildcard in LIKE, and event types can contain _. distinct handles an endpoint subscribed to both order.* and order.paid. It matches twice, but gets one
  delivery.

  3. new_deliveries: the permanent record, in state pending.

  4. queued: the to-do list, one row per new delivery with next_attempt_at = now(). It's due straight away,
  which is why the dispatcher runs create before deliver in the same tick.

   5. tenants: insert … on conflict do nothing. If the tenant is already in the rotation, it keeps its
  existing last_served_at and so keeps its place in line. A busy tenant can't move itself back to the front
  by sending more events.

  6. marked: sets deliveries_created_at = now(). This marks every event in the batch, including events that
  matched no endpoint. Otherwise an unmatched event would be picked up again on every tick, forever.

  It returns { events, deliveries }, and createBatch() in index.ts adds fullBatch: events === 20. That's the
  signal the dispatcher uses to tick again immediately for the rest of the backlog.
 */