import {
  Check,
  CircleSlash,
  Clock,
  Gauge,
  OctagonX,
  Repeat,
  RotateCw,
  SendHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Delivery } from "@/lib/deliveries";

// A delivery's state as a badge, in the words the design uses. The API's "pending" covers several
// situations, told apart by the counts: not tried yet, only throttled so far, or failing.
export function DeliveryState({ delivery }: { delivery: Delivery }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateBadge delivery={delivery} />
      {delivery.redelivered_from && (
        <Repeat
          aria-label="Redelivery of a dead delivery"
          role="img"
          className="size-3.5 text-fg-3"
        />
      )}
    </span>
  );
}

function StateBadge({ delivery }: { delivery: Delivery }) {
  switch (delivery.state) {
    case "succeeded":
      return (
        <Badge tone="ok" icon={Check}>
          Succeeded
        </Badge>
      );
    case "dead":
      return (
        <Badge tone="dead" icon={OctagonX}>
          Dead
        </Badge>
      );
    case "cancelled":
      return (
        <Badge tone="cancel" icon={CircleSlash}>
          Cancelled
        </Badge>
      );
    case "pending":
      if (delivery.in_flight) {
        return (
          <Badge tone="pend" icon={SendHorizontal}>
            Sending
          </Badge>
        );
      }
      if (delivery.attempt_count > 0) {
        return (
          <Badge tone="fail" icon={RotateCw}>
            Failing
          </Badge>
        );
      }
      if (delivery.throttled_count > 0) {
        return (
          <Badge tone="pend" icon={Gauge}>
            Throttled
          </Badge>
        );
      }
      return (
        <Badge tone="pend" icon={Clock}>
          Pending
        </Badge>
      );
  }
}
