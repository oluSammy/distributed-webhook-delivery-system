import { parseRetention, type Retention } from "@wds/core";
import { createDb } from "@wds/db";
import type { Sql } from "postgres";
import { wakeDispatcher } from "./dispatcher";

// How many days of partitions to keep made ahead of today, for events, deliveries and attempts.
const PARTITION_DAYS_AHEAD = 7;

// Expired idempotency keys are deleted this many at a time, at most this many times per run.
// Small batches keep each delete short, and let autovacuum keep up with the dead rows.
const KEYS_PER_BATCH = 1000;
const KEY_BATCHES_PER_RUN = 20;

// For drop_partitions_before, run with $1 = the end of a partition about to be dropped.
// A pending delivery still has its queue row, and needs its row in deliveries.
const DELIVERY_STILL_NEEDED = `
    select exists (select 1 from delivery_queue where delivery_created_at < $1)`;
// A queued delivery reads its event's payload when it's sent.
const EVENT_STILL_NEEDED = `
    select exists (
      select 1 from delivery_queue q
      join deliveries d on d.id = q.delivery_id and d.created_at = q.delivery_created_at
      where d.event_created_at < $1
    )`;

// The jobs the cron runs every 15 minutes. Each one runs on its own: if one fails, the rest still
// run, and the next run tries it again. One line is logged with what each did.
export async function runMaintenance(env: Env): Promise<void> {
  const sql = createDb(env.HYPERDRIVE.connectionString);
  const results: Record<string, unknown> = {};
  const run = async (name: string, job: () => Promise<unknown>) => {
    try {
      results[name] = await job();
    } catch (error) {
      console.error(`maintenance: ${name} failed`, error);
      results[name] = "failed";
    }
  };

  try {
    // First, because without today's partitions every new event, delivery and attempt fails.
    await run("partitions", async () => {
      await sql`select ensure_partitions(${PARTITION_DAYS_AHEAD})`;
      return "ok";
    });

    // Before un-parking, so a deleted endpoint's rows are cancelled rather than sent.
    await run("cancelled", () => cancelOnDeletedEndpoints(sql));
    await run("unparked", () => unparkReleased(sql));
    await run("tenants", () => repairTenantsWithWork(sql));
    await run("dropped", () => dropExpiredPartitions(sql, parseRetention(env)));
    await run("keys", () => deleteExpiredKeys(sql));
    // Last, so whatever the repairs made due is sent straight away. A wake-up or alarm can also be
    // lost, for example while the dispatcher is being redeployed. Waking it here means waiting
    // events and due deliveries never sit longer than one run. It also runs the create job, for
    // events stored when no wake-up reached it.
    await run("dispatcher", async () => {
      await wakeDispatcher(env);
      return "woken";
    });
  } finally {
    await sql.end();
  }
  console.log("maintenance", results);
}

// A delivery can be created for an endpoint while it's being deleted: the creator read it as not
// deleted yet. Its queue row would then be sent, or parked forever. Cancels those, as the delete
// would have. Returns how many.
async function cancelOnDeletedEndpoints(sql: Sql): Promise<number> {
  const cancelled = await sql`
      with dequeued as (
        delete from delivery_queue q
        using endpoints e
        where e.id = q.endpoint_id and e.state = 'deleted'
        returning q.delivery_id, q.delivery_created_at
      )
      update deliveries d
      set state = 'cancelled', finished_at = now()
      from dequeued
      where d.id = dequeued.delivery_id and d.created_at = dequeued.delivery_created_at
        and d.state = 'pending'
    `;
  return cancelled.count;
}

// Makes parked rows due again when nothing holds their endpoint any more. Normally a breaker close
// or a resume un-parks them, but a row given back at the same moment can be parked just after,
// with nothing left to wake it. Returns how many.
async function unparkReleased(sql: Sql): Promise<number> {
  const unparked = await sql`
      update delivery_queue q
      set next_attempt_at = now()
      from endpoint_holds h
      join endpoints e on e.id = h.endpoint_id
      where q.endpoint_id = h.endpoint_id
        and q.next_attempt_at = 'infinity'
        and not h.disabled and not h.paused
        and e.state <> 'deleted'
    `;
  return unparked.count;
}

// The claim only looks at tenants in tenants_with_work. Tenants with no queue rows left (parked
// ones count) are removed, so claims don't spend turns on them. Then any tenant with queue rows
// that's missing is put back: removing races with creating deliveries, whose "on conflict do
// nothing" can see the row just before it's removed. Returns how many were removed and added.
async function repairTenantsWithWork(sql: Sql): Promise<{ removed: number; added: number }> {
  const removed = await sql`
      delete from tenants_with_work w
      where not exists (select 1 from delivery_queue q where q.tenant_id = w.tenant_id)
    `;
  const added = await sql`
      insert into tenants_with_work (tenant_id)
      select t.id from tenants t
      where exists (select 1 from delivery_queue q where q.tenant_id = t.id)
      on conflict do nothing
    `;
  return { removed: removed.count, added: added.count };
}

// Drops the daily partitions of events and deliveries older than their retention, except any a
// pending delivery still needs: a delivery parked on a long-paused endpoint keeps its own row and
// its event's payload. Returns how many partitions of each were dropped.
async function dropExpiredPartitions(
  sql: Sql,
  retention: Retention,
): Promise<{ events: number; deliveries: number }> {
  const [events] = await sql<{ dropped: number }[]>`
      select drop_partitions_before(
        'events',
        now() - make_interval(days => ${retention.eventDays}),
        ${EVENT_STILL_NEEDED}
      ) as dropped
    `;
  const [deliveries] = await sql<{ dropped: number }[]>`
      select drop_partitions_before(
        'deliveries',
        now() - make_interval(days => ${retention.deliveryDays}),
        ${DELIVERY_STILL_NEEDED}
      ) as dropped
    `;
  return { events: events?.dropped ?? 0, deliveries: deliveries?.dropped ?? 0 };
}

// Deletes idempotency keys past their 24 hours, a batch at a time. Whatever is left over waits
// for the next run. Returns how many.
async function deleteExpiredKeys(sql: Sql): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < KEY_BATCHES_PER_RUN; batch++) {
    const keys = await sql`
        delete from idempotency_keys
        where (tenant_id, key) in (
          select tenant_id, key from idempotency_keys
          where expires_at < now()
          limit ${KEYS_PER_BATCH}
        )
      `;
    deleted += keys.count;
    if (keys.count < KEYS_PER_BATCH) {
      break;
    }
  }
  return deleted;
}
