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

// What the Deliveries page is showing: a state, and optionally one endpoint's or one event's.
export type DeliveryFilters = {
  state: StateFilter;
  endpointId: string | null;
  eventId: string | null;
};

export const NO_FILTERS: DeliveryFilters = { state: "all", endpointId: null, eventId: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The filters from the page's address (?state=dead&endpoint_id=…). Anything not understood is
// left out, as if it weren't there.
export function toFilters(query: {
  state?: string;
  endpoint_id?: string;
  event_id?: string;
}): DeliveryFilters {
  return {
    state: STATE_FILTERS.find((state) => state === query.state) ?? "all",
    endpointId: query.endpoint_id && UUID.test(query.endpoint_id) ? query.endpoint_id : null,
    eventId: query.event_id && UUID.test(query.event_id) ? query.event_id : null,
  };
}

function filterQuery(filters: DeliveryFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.state !== "all") {
    query.set("state", filters.state);
  }
  if (filters.endpointId) {
    query.set("endpoint_id", filters.endpointId);
  }
  if (filters.eventId) {
    query.set("event_id", filters.eventId);
  }
  return query;
}

// The API call for one page of the list.
export function deliveriesPath(filters: DeliveryFilters, cursor?: string): string {
  const query = filterQuery(filters);
  query.set("limit", "50");
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `/api/deliveries?${query}`;
}

// The Deliveries page's own address for these filters: "/deliveries?state=dead".
export function deliveriesPage(filters: DeliveryFilters): string {
  const query = filterQuery(filters).toString();
  return query ? `/deliveries?${query}` : "/deliveries";
}

export type Attempt = {
  attempt_number: number;
  signed_timestamp: number; // the webhook-timestamp header it was sent with
  outcome: "success" | "failure" | "throttled" | "non_retryable";
  response_status: number | null;
  response_body: string | null; // the start of the response, failed attempts only
  error_kind: string | null; // why no response came back: timeout, conn_refused…
  latency_ms: number | null;
  stale: boolean; // came back after a newer attempt had taken over, so it changed nothing
  started_at: string;
  finished_at: string | null;
};

export type DeliveryDetail = Delivery & {
  attempts: Attempt[];
  request_body: string | null; // the exact body every attempt sent; null past the event's retention
  other_deliveries: Delivery[]; // the same event's deliveries to its other endpoints
};
