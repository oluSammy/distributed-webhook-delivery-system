export interface DispatcherApi extends Rpc.DurableObjectBranded {
  wake(): Promise<void>;
}
