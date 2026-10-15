import { WorkerEntrypoint } from "cloudflare:workers";
import { claimDeliveries, DELIVERIES_PER_BATCH } from "./claim";
import type { BatchResult, DeliveryApi } from "./contract";
import { createDeliveries, EVENTS_PER_BATCH } from "./create-deliveries";
import { createDb } from "./db";

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
  async runBatch(shard: number): Promise<BatchResult> {
    const sql = createDb(this.env);
    try {
      const created = await createDeliveries(sql);
      const callId = `shard-${shard}/${crypto.randomUUID()}`;
      const claims = await claimDeliveries(sql, callId);
      console.log(`delivery ${callId}: created`, created, `claimed ${claims.length}`);
      return {
        claimed: claims.length,
        nextDueAt: null,
        fullBatch: created.events === EVENTS_PER_BATCH || claims.length === DELIVERIES_PER_BATCH,
      };
    } finally {
      this.ctx.waitUntil(sql.end());
    }
  }

  override async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}
