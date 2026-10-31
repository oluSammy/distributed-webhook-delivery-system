import type { Acquired, BreakerChange, Classification, EndpointLimits } from "@wds/core";

export interface LimiterApi extends Rpc.DurableObjectBranded {
  acquire(limits: EndpointLimits, leaseMs: number): Promise<Acquired>;
  release(slotId: string, result: Classification | null): Promise<BreakerChange | null>;
}
