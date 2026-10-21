export interface DeliveryApi extends Rpc.WorkerEntrypointBranded {
  runBatch: (shard: number) => Promise<BatchResult>;
}

export type BatchResult = {
  claimed: number;
};
