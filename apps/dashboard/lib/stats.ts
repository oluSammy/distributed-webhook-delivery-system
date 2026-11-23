// The ranges the Overview offers, as GET /api/stats takes them.
export const RANGES = ["1h", "24h", "7d"] as const;
export type Range = (typeof RANGES)[number];

export const RANGE_LABELS: Record<Range, string> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
};

export type Outcomes = { succeeded: number; dead: number; pending: number };

// GET /api/stats (routes/stats.ts).
export type Stats = {
  range: Range;
  since: string;
  step_seconds: number;
  events: number;
  deliveries: Outcomes;
  failing_now: number;
  dead_in_dlq: number;
  series: (Outcomes & { at: string })[];
};

// "?range=…" from the address, or 24 hours when it's missing or not one we offer.
export function toRange(value: string | undefined): Range {
  return RANGES.find((range) => range === value) ?? "24h";
}
