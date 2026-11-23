// An event type as GET /api/event-types lists it.
export type EventType = {
    name: string;
    created_at: string;
    endpoints: number; // endpoints its events reach (not deleted, a subscription matches)
  };