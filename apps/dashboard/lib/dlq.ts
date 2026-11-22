export type DeadDelivery = {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  endpoint_description: string | null;
  endpoint_url: string | null;
  failure_reason: string;
  attempt_count: number;
  throttled_count: number;
  created_at: string;
  finished_at: string; // when it died
  last_status: number | null;
  last_error_kind: string | null;
};

export type DeadPage = { deliveries: DeadDelivery[]; next_cursor: string | null };

// GET /api/dlq/counts: how many match, in all and by reason.
export type DlqCounts = { total: number; reasons: { reason: string; count: number }[] };

// Why a delivery died, in words for the chips and the table.
const REASONS: Record<string, string> = {
  max_attempts: "Out of attempts",
  max_age: "Too old to retry",
  gone: "410 Gone",
  url_not_allowed: "URL not allowed",
};

export function reasonLabel(reason: string): string {
  return REASONS[reason] ?? reason;
}

export function dlqPath(reason: string | null, cursor?: string): string {
  const query = new URLSearchParams({ limit: "50" });
  if (reason) {
    query.set("reason", reason);
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `/api/dlq?${query}`;
}
