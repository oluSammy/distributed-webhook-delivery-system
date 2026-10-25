import { DurableObject } from "cloudflare:workers";
import { nextTickAt } from "@wds/core";
import type { CreateResult, CreatorApi } from "@wds/creator/contract";
import { createDb } from "@wds/db";
import type { DeliveryApi } from "@wds/delivery/contract";
import type { DispatcherApi } from "./contract";

// Each tick runs the create job (when there may be new events), then the deliver job, then sets
// the alarm for the next tick: now if more work is waiting, when the next delivery is due, or not
// at all when the queue is empty.
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

    // Create first, so the new deliveries are sent in this same tick. Each job's failure is
    // caught on its own: if creating fails, waiting deliveries (retries included) are still sent.
    const created = createNow ? await this.createJob() : null;
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
        failed: created === "failed" || claimed === null || nextDueAt === "failed",
      },
      Date.now(),
    );
    console.log("dispatcher: tick", {
      created,
      claimed,
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

  // The earliest next_attempt_at in the queue: claimed rows count at the end of their lease,
  // which is when they come back if their call crashed.
  private async nextDueAt(): Promise<number | null | "failed"> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const [row] = await sql<{ next_due_at: Date | null }[]>`
        select min(next_attempt_at) as next_due_at from delivery_queue
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
