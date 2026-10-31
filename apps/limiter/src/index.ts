import { DurableObject } from "cloudflare:workers";
import {
  type Acquired,
  type BreakerChange,
  type Classification,
  type EndpointLimits,
  type LimiterHealth,
  LimiterState,
} from "@wds/core";
import type { LimiterApi } from "./contract";

// One instance per endpoint, named by its id. Cloudflare runs a single instance per name and hands
// it one request at a time, so every Delivery Worker call sees the same counts and no two acquires
// can race. The state is in memory only: if the instance is evicted, the next one starts with a
// full bucket and no slots held, which allows at most one extra second's burst.
export class EndpointLimiter extends DurableObject<Env> implements LimiterApi {
  private readonly state = new LimiterState();

  async acquire(limits: EndpointLimits, leaseMs: number): Promise<Acquired> {
    return this.state.acquire(limits, leaseMs, Date.now());
  }

  async release(slotId: string, result: Classification | null): Promise<BreakerChange | null> {
    return this.state.release(slotId, result, Date.now());
  }

  async health(limits: EndpointLimits): Promise<LimiterHealth> {
    return this.state.health(limits, Date.now());
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
