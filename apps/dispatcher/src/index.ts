import { DurableObject } from "cloudflare:workers";
import type { DeliveryApi } from "@wds/delivery/contract"
import type { DispatcherApi } from "./contract"

export class Dispatcher extends DurableObject<Env> implements DispatcherApi {
    private get delivery() {
        return this.env.DELIVERY as Service<DeliveryApi>
    }

    async wake() {
        const result = await this.delivery.runBatch(0);
        console.log("dispatcher: batch finished", result)
        return result
    }
}

export default {
    async fetch() {
        return new Response("Not found", { status: 404 })
    }
} satisfies ExportedHandler<Env>;