import type { Sql } from "postgres";

export const EVENTS_PER_BATCH = 20;
// Tenants looked at per batch. Their waiting events are taken in turn, one from each, so with two
// tenants waiting each gets 10 of the 20, and a tenant alone gets all 20.
const TENANTS_PER_BATCH = 10;

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
  const [result] = await sql<(DeliveriesCreated & { emptied: string[] })[]>`
      with next_tenants as (
        select tenant_id, last_served_at
        from tenants_with_events
        order by last_served_at
        limit ${TENANTS_PER_BATCH}
        for update skip locked
      ),
      candidates as (
        select e.id, e.created_at, e.tenant_id, e.type,
               row_number() over (partition by e.tenant_id order by e.created_at) as nth,
               t.last_served_at
        from next_tenants t
        cross join lateral (
          select id, created_at, tenant_id, type
          from events
          where tenant_id = t.tenant_id and deliveries_created_at is null
          order by created_at
          limit ${EVENTS_PER_BATCH}
        ) e
      ),
      pending as (
        select id, created_at, tenant_id, type
        from candidates
        order by nth, last_served_at, tenant_id
        limit ${EVENTS_PER_BATCH}
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
        where event_type_matches(s.event_type_pattern, p.type)
      ),
      new_deliveries as (
        insert into deliveries (tenant_id, event_id, event_created_at, endpoint_id)
        select tenant_id, event_id, event_created_at, endpoint_id from matched
        returning id, created_at, tenant_id, endpoint_id
      ),
      queued as (
        insert into delivery_queue (delivery_id, delivery_created_at, tenant_id, endpoint_id, next_attempt_at)
        select d.id, d.created_at, d.tenant_id, d.endpoint_id,
                case
                  when h.paused then 'infinity'::timestamptz
                  when h.disabled and exists (
                    select 1 from delivery_queue q
                    where q.endpoint_id = d.endpoint_id and q.next_attempt_at = 'infinity'
                  ) then 'infinity'::timestamptz
                  else now()
                end
        from new_deliveries d
        join endpoint_holds h on h.endpoint_id = d.endpoint_id
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
      ),
      rotated as (
        update tenants_with_events w
        set last_served_at = now()
        where w.tenant_id in (select tenant_id from pending)
      )
      select (select count(*) from marked)::int as events,
             (select count(*) from new_deliveries)::int as deliveries,
             -- Tenants whose every waiting event was taken: they may have none left.
             (select coalesce(json_agg(t.tenant_id), '[]'::json) from next_tenants t
              where (select count(*) from candidates c where c.tenant_id = t.tenant_id) < ${EVENTS_PER_BATCH}
                and not exists (
                  select 1 from candidates c
                  where c.tenant_id = t.tenant_id and c.id not in (select id from pending)
                )
             ) as emptied
    `;
  if (!result) {
    return { events: 0, deliveries: 0 };
  }
  if (result.emptied.length > 0) {
    await removeEmptied(sql, result.emptied);
  }
  return { events: result.events, deliveries: result.deliveries };
}

// Takes tenants with no waiting events left out of tenants_with_events. The API Worker adds a tenant
// back when it stores an event, in the same statement, locking the tenant's row. Locking the rows
// first here, then checking for waiting events in a second statement (which sees everything
// committed by then), means an event stored meanwhile is never left without its tenant:
// - the API locked first: this waits until it commits, then sees its event, and keeps the tenant;
// - this locked first: the API waits until the delete commits, then inserts the tenant afresh.
async function removeEmptied(sql: Sql, tenantIds: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
        select 1 from tenants_with_events
        where tenant_id in (select jsonb_array_elements_text(${tx.json(tenantIds)})::uuid)
        for update
      `;
    await tx`
        delete from tenants_with_events w
        where w.tenant_id in (select jsonb_array_elements_text(${tx.json(tenantIds)})::uuid)
          and not exists (
            select 1 from events e
            where e.tenant_id = w.tenant_id and e.deliveries_created_at is null
          )
      `;
  });
}

/**
 * * 1. pending: take a batch, fairly between tenants
 * next_tenants: up to 10 tenants from tenants_with_events, least recently served first. for update skip
    locked locks their rows, so a second create running at the same time takes other tenants.
 * candidates: each one's oldest waiting events (at most 20), numbered 1, 2, 3… per tenant (nth). The
    partial index idx_events_waiting (tenant_id, created_at) holds only waiting events, so this stays fast
    however big events gets.
 * pending: the batch, 20 events taken in turns: every tenant's 1st, then every tenant's 2nd, and so on.
    With tenant A's 10,000 waiting and tenant B's 1, B's event is in the very next batch. A tenant alone
    still gets all 20.

    2. matched: work out who receives each event
    An endpoint receives an event when all of these hold:
  - Same tenant
  - state <> 'deleted'. Paused and disabled endpoints still get deliveries, so nothing is lost: they're
    queued parked, and sent after the resume or the breaker's close.
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

   6. rotated: the tenants served move to the back of the line (last_served_at = now()).

  7. emptied: tenants whose every waiting event was taken. removeEmptied takes them out of
  tenants_with_events if they really have none left, so the next batches don't spend turns on them.

  8. marked: sets deliveries_created_at = now(). This marks every event in the batch, including events that
  matched no endpoint. Otherwise an unmatched event would be picked up again on every tick, forever.

  It returns { events, deliveries }, and createBatch() in index.ts adds fullBatch: events === 20. That's the
  signal the dispatcher uses to tick again immediately for the rest of the backlog.
 */
