import { DurableObject } from "cloudflare:workers";
import { nextTickAt } from "@wds/core";
import type { CreateResult, CreatorApi } from "@wds/creator/contract";
import { createDb } from "@wds/db";
import type { DeliveryApi } from "@wds/delivery/contract";
import type { DispatcherApi } from "./contract";

// After a probe is sent, the endpoint's next probe time moves on by this much, in case the probe
// is lost. It's longer than a delivery claim's lease (90 s), so a probe still in flight isn't
// doubled. The probe's result then sets the real time: the next cool-down, or none once it's back.
const PROBE_RETRY = "2 minutes";

// A disabled endpoint with nothing parked has nothing to probe with. Its next new delivery gets
// probed by the limiter anyway, so its probe time only needs to come round rarely.
const IDLE_PROBE_RETRY = "30 minutes";

// Each tick runs the create job (when there may be new events), the probe job, then the deliver
// job, then sets the alarm for the next tick: now if more work is waiting, when the next delivery
// or probe is due, or not at all when there's nothing left to do.
export class Dispatcher extends DurableObject<Env> implements DispatcherApi {
  // Whether the next tick should run the create job. It lives in memory rather than storage, which
  // saves a storage write per event. A fresh instance starts with true, so a wake-up that was lost
  // when the instance was evicted or redeployed still gets its events' deliveries created.
  private createWanted = true;

  private get creator() {
    return this.env.CREATOR as Service<CreatorApi>;
  }

  private get delivery() {
    return this.env.DELIVERY as Service<DeliveryApi>;
  }

  // Called by the API worker after it stores events: asks for a tick now. Writes to storage only when
  // no tick is already due, so a burst of events costs one alarm, not one per event.
  async wake(): Promise<void> {
    this.createWanted = true;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > Date.now()) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  override async alarm(): Promise<void> {
    const createNow = this.createWanted;
    this.createWanted = false;

    // Create first, so the new deliveries are sent in this same tick, and make probes due before
    // delivering for the same reason. Each job's failure is caught on its own: if creating fails,
    // waiting deliveries (retries included) are still sent.
    const created = createNow ? await this.createJob() : null;
    const probes = await this.probeJob();
    const claimed = await this.deliverJob();
    const nextDueAt = await this.nextDueAt();

    const wokenDuringTick = this.createWanted;
    const moreEvents = created !== null && created !== "failed" && created.fullBatch;
    if (created === "failed" || moreEvents) {
      this.createWanted = true; // the next tick creates again: to retry, or for the rest of the backlog
    }
    const next = nextTickAt(
      {
        runAgainNow: wokenDuringTick || moreEvents,
        claimed: claimed ?? 0,
        nextDueAt: nextDueAt === "failed" ? null : nextDueAt,
        failed:
          created === "failed" || probes === "failed" || claimed === null || nextDueAt === "failed",
      },
      Date.now(),
    );
    console.log("dispatcher: tick", {
      created,
      claimed,
      probes,
      next: next === null ? "sleep" : new Date(next).toISOString(),
    });

    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }

  private async createJob(): Promise<CreateResult | "failed"> {
    try {
      return await this.creator.createBatch();
    } catch (error) {
      console.error("dispatcher: create job failed", error);
      return "failed";
    }
  }

  // Runs the delivery calls in parallel. Returns how many deliveries they claimed in total,
  // or null when any of them failed.
  private async deliverJob(): Promise<number | null> {
    const count = Math.min(6, Math.max(1, Number.parseInt(this.env.DELIVERY_CALLS, 10) || 1));
    const results = await Promise.all(
      Array.from({ length: count }, (_, shard) =>
        this.delivery.runBatch(shard).catch((error) => {
          console.error(`dispatcher: delivery call ${shard} failed`, error);
          return null;
        }),
      ),
    );
    let claimed = 0;
    for (const result of results) {
      if (result === null) {
        return null;
      }
      claimed += result.claimed;
    }
    return claimed;
  }

  // Makes one parked delivery due for each disabled endpoint whose probe time has come, so the
  // limiter sends it as the probe, and moves that endpoint's probe time on. Returns how many.
  private async probeJob(): Promise<number | "failed"> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const probes = await sql`
        with due as (
          select e.id,
            (select q.delivery_id from delivery_queue q
             where q.endpoint_id = e.id and q.next_attempt_at = 'infinity'
             limit 1) as delivery_id
          from endpoints e
          where e.state = 'disabled' and e.probe_at <= now()
        ),
        moved_on as (
          update endpoints e
          set probe_at = now() + case
                when due.delivery_id is null then ${IDLE_PROBE_RETRY}::interval
                else ${PROBE_RETRY}::interval
              end
          from due
          where e.id = due.id
        )
        update delivery_queue q
        set next_attempt_at = now()
        from due
        where q.delivery_id = due.delivery_id
      `;
      return probes.count;
    } catch (error) {
      console.error("dispatcher: probe job failed", error);
      return "failed";
    } finally {
      await sql.end();
    }
  }

  // When the next tick is needed: the earliest next_attempt_at in the queue, or the earliest
  // probe time of a disabled endpoint. Claimed rows count at the end of their lease, which is when
  // they come back if their call crashed. Parked rows ('infinity') are never due.
  private async nextDueAt(): Promise<number | null | "failed"> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const [row] = await sql<{ next_due_at: Date | null }[]>`
        select least(
          (select min(next_attempt_at) from delivery_queue where next_attempt_at < 'infinity'),
          (select min(probe_at) from endpoints where state = 'disabled')
        ) as next_due_at
      `;
      return row?.next_due_at?.getTime() ?? null;
    } catch (error) {
      console.error("dispatcher: next-due query failed", error);
      return "failed";
    } finally {
      await sql.end();
    }
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
