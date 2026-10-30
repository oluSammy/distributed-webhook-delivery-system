import type { DispatcherApi } from "@wds/dispatcher/contract";

// Tells the dispatcher there's work due now, so it doesn't sleep until its alarm.
export function wakeDispatcher(env: Env): Promise<unknown> {
  const dispatchers = env.DISPATCHER as DurableObjectNamespace<DispatcherApi>;
  return dispatchers
    .getByName("shard-0")
    .wake()
    .catch((err) => console.error("wake failed", err));
}
