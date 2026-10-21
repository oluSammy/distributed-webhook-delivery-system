import { DurableObject } from "cloudflare:workers";
import type { CreatorApi } from "@wds/creator/contract";
import type { DeliveryApi } from "@wds/delivery/contract";
import type { DispatcherApi } from "./contract";

export class Dispatcher extends DurableObject<Env> implements DispatcherApi {
  private get creator() {
    return this.env.CREATOR as Service<CreatorApi>;
  }

  private get delivery() {
    return this.env.DELIVERY as Service<DeliveryApi>;
  }

  async wake(): Promise<void> {
    const created = await this.creator.createBatch().catch((error) => {
      console.error("dispatcher: create job failed", error);
      return null;
    });
    const delivered = await this.delivery.runBatch(0).catch((error) => {
      console.error("dispatcher: deliver job failed", error);
      return null;
    });
    console.log("dispatcher: woke", { created, delivered });
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
