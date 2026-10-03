import { WorkerEntrypoint } from "cloudflare:workers"
import type { DeliveryApi, BatchResult } from "./contract"

export default class Delivery extends WorkerEntrypoint<Env> implements DeliveryApi {
    async runBatch(shard: number): Promise<BatchResult> {
        console.log(`delivery runBatch called for shard ${shard}`)
        return { claimed: 0, fullBatch: false, nextDueAt: null }
    }

    override async fetch(): Promise<Response>{
        return new Response("Not found", { status: 404 })
    }
}