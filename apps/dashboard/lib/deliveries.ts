// A delivery as GET /api/deliveries returns it (the API's Delivery schema in routes/deliveries.ts).
export type Delivery = {
  id: string;
  event_id: string;
  event_type: string | null;
  endpoint_id: string;
  endpoint_description: string | null;
  endpoint_url: string | null;
  state: "pending" | "succeeded" | "dead" | "cancelled";
  last_status: number | null;
  last_error_kind: string | null;
  attempt_count: number;
  throttled_count: number;
  failure_reason: string | null;
  redelivered_from: string | null;
  resolution: string | null;
  resolved_at: string | null;
  next_attempt_at: string | null;
  in_flight: boolean;
  created_at: string;
  finished_at: string | null;
};

export type DeliveryPage = { deliveries: Delivery[]; next_cursor: string | null };

// The state filter's choices, and what each asks the API for.
export const STATE_FILTERS = ["all", "pending", "succeeded", "dead", "cancelled"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export function deliveriesPath(state: StateFilter, cursor?: string): string {
  const query = new URLSearchParams({ limit: "50" });
  if (state !== "all") {
    query.set("state", state);
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `/api/deliveries?${query}`;
}
