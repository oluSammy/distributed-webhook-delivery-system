import { Badge } from "@/components/ui/Badge";
import type { EventSummary } from "@/lib/events";

// How an event's deliveries are doing, in one line: "3 arrived · 1 died", or why there are none.
export function EventDeliveries({ event }: { event: EventSummary }) {
  if (event.deliveries_created_at === null) {
    return <Badge tone="pend">Making deliveries…</Badge>;
  }
  const { total, succeeded, pending, dead, cancelled } = event.deliveries;
  if (total === 0) {
    return <span className="text-fg-3">No endpoint subscribed</span>;
  }
  const parts: { count: number; label: string; className: string }[] = [
    { count: succeeded, label: "arrived", className: "text-ok" },
    { count: pending, label: "pending", className: "text-pend" },
    { count: dead, label: "died", className: "text-dead" },
    { count: cancelled, label: "cancelled", className: "text-cancel" },
  ];
  return (
    <span className="tabular-nums">
      {parts
        .filter((part) => part.count > 0)
        .map((part, index) => (
          <span key={part.label}>
            {index > 0 && <span className="text-fg-3"> · </span>}
            <span className={part.className}>
              {part.count.toLocaleString("en")} {part.label}
            </span>
          </span>
        ))}
    </span>
  );
}
