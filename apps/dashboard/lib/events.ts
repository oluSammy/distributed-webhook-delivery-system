// An event in GET /api/events: no payload (GET /api/events/{id} has it), its deliveries counted.
export type EventSummary = {
  id: string;
  type: string;
  created_at: string;
  deliveries_created_at: string | null; // null while its deliveries are still being made
  deliveries: {
    total: number;
    succeeded: number;
    pending: number;
    dead: number;
    cancelled: number;
  };
};

export type EventPage = { events: EventSummary[]; next_cursor: string | null };

// GET /api/events/{id}: one event, with its payload.
export type EventDetail = {
  id: string;
  type: string;
  payload: unknown;
  created_at: string;
  deliveries_created_at: string | null;
};

export function eventsPath(type: string | null, cursor?: string): string {
  const query = new URLSearchParams({ limit: "50" });
  if (type) {
    query.set("type", type);
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `/api/events?${query}`;
}
