import { LocalTime } from "@/components/LocalTime";
import type { Delivery } from "@/lib/deliveries";

// When a pending delivery is next tried. A pending one with no time is parked: its endpoint is
// paused or disabled, so it waits without a time. Used in the Deliveries list and on an endpoint's
// page.
export function NextAttempt({ delivery }: { delivery: Delivery }) {
  if (delivery.state !== "pending") {
    return <span className="text-fg-3">—</span>;
  }
  if (delivery.in_flight) {
    return <span className="text-fg-2">Sending now</span>;
  }
  if (!delivery.next_attempt_at) {
    return <span className="text-fg-2">Waiting for the endpoint</span>;
  }
  return <LocalTime iso={delivery.next_attempt_at} />;
}
