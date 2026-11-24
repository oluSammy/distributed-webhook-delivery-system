// GET /api/usage: events accepted today (UTC) against the daily limit.
export type Usage = {
  day: string;
  events: number;
  daily_limit: number;
  resets_at: string; // the next 00:00 UTC
};

// How close today's count is to the limit: "high" from 80%, "full" at the limit, when new events
// are refused.
export type UsageLevel = "ok" | "high" | "full";

export function usageLevel(usage: Usage): UsageLevel {
  if (usage.events >= usage.daily_limit) {
    return "full";
  }
  return usage.events >= usage.daily_limit * 0.8 ? "high" : "ok";
}

// The share used, as a whole percent: 41,200 of 50,000 is 82. Never over 100.
export function usagePercent(usage: Usage): number {
  return Math.min(100, Math.floor((usage.events / usage.daily_limit) * 100));
}
