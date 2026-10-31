import type { Acquired, EndpointLimits } from "@wds/core";

export interface LimiterApi extends Rpc.DurableObjectBranded {
  acquire(limits: EndpointLimits, leaseMs: number): Promise<Acquired>;
  release(slotId: string): Promise<void>;
}
