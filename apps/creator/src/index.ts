import { WorkerEntrypoint } from "cloudflare:workers";
import { createDb } from "@wds/db";
import type { CreateResult, CreatorApi } from "./contract";
import { createDeliveries, EVENTS_PER_BATCH } from "./create-deliveries";

export default class Creator extends WorkerEntrypoint<Env> implements CreatorApi {
  async createBatch(): Promise<CreateResult> {
    const sql = createDb(this.env.HYPERDRIVE.connectionString);
    try {
      const created = await createDeliveries(sql);
      console.log("creator: created", created);
      return { ...created, fullBatch: created.events === EVENTS_PER_BATCH };
    } finally {
      this.ctx.waitUntil(sql.end());
    }
  }

  override async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}
