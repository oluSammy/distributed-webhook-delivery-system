// How many days each kind of row is kept. Partitions are daily, so whole days.
export type Retention = { attemptDays: number; deliveryDays: number; eventDays: number };

// The longest a delivery is retried, in days: max_age_seconds is at most 72 h.
const LONGEST_DELIVERY_DAYS = 3;

// The retention settings, from the API Worker's vars, checked. Throws when one is missing or
// breaks a rule, so a bad config drops nothing:
// - attempts are kept at least 3 days, so a delivery still being retried keeps its whole history.
// - events are kept at least 3 days longer than deliveries: a dead delivery can be redelivered
//   until its own partition goes, and the new delivery reads its event's payload for up to 72 h.
export function parseRetention(vars: {
  ATTEMPT_RETENTION_DAYS?: string;
  DELIVERY_RETENTION_DAYS?: string;
  EVENT_RETENTION_DAYS?: string;
}): Retention {
  const days = (name: keyof typeof vars): number => {
    const value = Number(vars[name]);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a whole number of days, at least 1`);
    }
    return value;
  };
  const retention = {
    attemptDays: days("ATTEMPT_RETENTION_DAYS"),
    deliveryDays: days("DELIVERY_RETENTION_DAYS"),
    eventDays: days("EVENT_RETENTION_DAYS"),
  };
  if (retention.attemptDays < LONGEST_DELIVERY_DAYS) {
    throw new Error(`ATTEMPT_RETENTION_DAYS must be at least ${LONGEST_DELIVERY_DAYS}`);
  }
  if (retention.eventDays < retention.deliveryDays + LONGEST_DELIVERY_DAYS) {
    throw new Error(
      `EVENT_RETENTION_DAYS must be at least DELIVERY_RETENTION_DAYS + ${LONGEST_DELIVERY_DAYS}`,
    );
  }
  return retention;
}
