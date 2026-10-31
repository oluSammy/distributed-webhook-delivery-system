import type { Acquired, Classification, EndpointLimits } from "@wds/core";

export interface LimiterApi extends Rpc.DurableObjectBranded {
  acquire(limits: EndpointLimits, leaseMs: number): Promise<Acquired>;
  release(slotId: string, result: Classification | null): Promise<void>;
}
