import type { Sql } from "postgres";

// When the Dispatcher's next tick is needed: the earliest next_attempt_at in the queue, or the
// earliest probe time of a disabled endpoint, whichever comes first; null when there's nothing.
// Claimed rows count at the end of their lease, which is when they come back if their call
// crashed. Parked rows ('infinity') are never due.
//
// The queue is asked tenant by tenant, for each tenant in tenants_with_work: its earliest row is
// the first entry of its part of idx_queue_ready (tenant_id, next_attempt_at). Every queued row's
// tenant is there (whatever queues a delivery adds it, and it's only removed once the tenant has no
// rows), and the claim reads the same list, so a row this misses couldn't be claimed either.
export async function findNextDue(sql: Sql): Promise<Date | null> {
  const [row] = await sql<{ next_due_at: Date | null }[]>`
        select least(
          (select min(n.next_attempt_at)
           from tenants_with_work w
           cross join lateral (
             select q.next_attempt_at
             from delivery_queue q
             where q.tenant_id = w.tenant_id and q.next_attempt_at < 'infinity'
             order by q.next_attempt_at
             limit 1
           ) n),
          (select min(probe_at) from endpoints where state = 'disabled')
        ) as next_due_at
      `;
  return row?.next_due_at ?? null;
}
