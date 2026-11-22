// An endpoint as GET /api/endpoints returns it.
export type Endpoint = {
  id: string;
  url: string;
  description: string;
  state: "active" | "paused" | "disabled";
  subscriptions: string[];
  rate_limit_per_s: number;
  concurrency_limit: number;
  created_at: string;
  deliveries_24h: { succeeded: number; dead: number; pending: number };
  last_delivery_at: string | null;
};

// POST /api/endpoints' answer: the endpoint, and its signing secret, shown only this once.
export type CreatedEndpoint = Endpoint & { signing_secret: string };

// Of its deliveries in the last 24 hours that finished, the share that arrived, as "97.3%"; null
// when none finished yet (a percentage of nothing would mislead).
export function successRate(endpoint: Endpoint): string | null {
  const { succeeded, dead } = endpoint.deliveries_24h;
  const finished = succeeded + dead;
  return finished === 0 ? null : `${((succeeded / finished) * 100).toFixed(1)}%`;
}

// The name to show: its description, or its URL when it has none.
export function endpointName(endpoint: Pick<Endpoint, "description" | "url">): string {
  return endpoint.description || endpoint.url;
}

// GET /api/endpoints/{id}/health: its state, and what its limiter knows right now.
export type EndpointHealth = {
  health: "healthy" | "degraded" | "disabled" | "paused";
  probe_at: string | null; // disabled: when the next probe may go
  limiter: {
    rate_limit_per_s: number;
    current_rate_per_s: number; // lower than the limit while recovering from a throttle
    concurrency_limit: number;
    slots_in_use: number;
    throttled_until: string | null;
    breaker: "closed" | "open" | "half_open";
    recent_attempts: number; // the breaker's window: sent attempts in the last 10 minutes
    recent_failures: number;
  } | null; // null when the limiter can't be reached
};
