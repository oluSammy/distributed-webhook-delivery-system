import { WorkerEntrypoint } from "cloudflare:workers";
import type { BatchResult, DeliveryApi } from "./contract";
import { createDeliveries, EVENTS_PER_BATCH } from "./create-deliveries";
import { createDb } from "./db";

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
  async runBatch(shard: number): Promise<BatchResult> {
    const sql = createDb(this.env);
    try {
      const created = await createDeliveries(sql);
      console.log(`delivery shard ${shard}: created deliveries`, created);
      return {
        claimed: 0,
        nextDueAt: null,
        fullBatch: created.events === EVENTS_PER_BATCH,
      };
    } finally {
      this.ctx.waitUntil(sql.end());
    }
  }

  override async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}
