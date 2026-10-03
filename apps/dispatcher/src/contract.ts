import type { BatchResult } from "@wds/delivery/contract";

export interface DispatcherApi extends Rpc.DurableObjectBranded {
  wake(): Promise<BatchResult>;
}
