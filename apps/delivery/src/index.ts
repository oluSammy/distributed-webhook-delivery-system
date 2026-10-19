import { WorkerEntrypoint } from "cloudflare:workers";
import { importMasterKey } from "@wds/core";
import { claimDeliveries, DELIVERIES_PER_BATCH } from "./claim";
import type { BatchResult, DeliveryApi } from "./contract";
import { createDeliveries, EVENTS_PER_BATCH } from "./create-deliveries";
import { createDb } from "./db";
import { forEachLimited } from "./limit";
import { Sender, type SendResult } from "./send";

// Workers allow 6 open connections per call; more would queue, with their timeouts already running.
const MAX_IN_FLIGHT = 6;

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
  async runBatch(shard: number): Promise<BatchResult> {
    const sql = createDb(this.env);
    try {
      const created = await createDeliveries(sql);
      const callId = `shard-${shard}/${crypto.randomUUID()}`;
      const claims = await claimDeliveries(sql, callId);
      console.log(`delivery ${callId}: created`, created, `claimed ${claims.length}`);

      if (claims.length > 0) {
        const masters = new Map([[1, await importMasterKey(this.env.MASTER_KEY_V1, 1)]]);
        const sender = new Sender(masters, this.env.ALLOW_LOCAL_ENDPOINTS === "true");
        await forEachLimited(claims, MAX_IN_FLIGHT, async (claim) => {
          const result = await sender.send(claim);
          console.log(`delivery ${claim.delivery_id} → ${claim.url}: ${describe(result)}`);
        });
      }
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

function describe(result: SendResult): string {
  switch (result.kind) {
    case "response":
      return `HTTP ${result.status} in ${result.latencyMs} ms`;
    case "error":
      return `${result.error instanceof Error ? result.error.name : "error"} after ${result.latencyMs} ms`;
    case "blocked":
      return `not sent: ${result.reason}`;
  }
}
