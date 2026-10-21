import type { DeliveriesCreated } from "./create-deliveries";

export type CreateResult = DeliveriesCreated & {
  fullBatch: boolean; // the batch was full, so more events may be waiting
};

export interface CreatorApi extends Rpc.WorkerEntrypointBranded {
  createBatch: () => Promise<CreateResult>;
}
