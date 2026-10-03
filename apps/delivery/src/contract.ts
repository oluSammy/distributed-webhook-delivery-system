export type BatchResult = {
    claimed: number;
    fullBatch: boolean;
    nextDueAt: string | null;
};

export interface DeliveryApi extends Rpc.WorkerEntrypointBranded {
    runBatch: (shard: number) => Promise<BatchResult>;
}