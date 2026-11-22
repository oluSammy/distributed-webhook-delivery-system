import { Ban, Check, Pause } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Endpoint } from "@/lib/endpoints";

// An endpoint's state as a badge. Disabled means the circuit breaker stopped sending after too many
// failures; paused means someone paused it.
export function EndpointState({ state }: { state: Endpoint["state"] }) {
  switch (state) {
    case "active":
      return (
        <Badge tone="ok" icon={Check}>
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge tone="pause" icon={Pause}>
          Paused
        </Badge>
      );
    case "disabled":
      return (
        <Badge tone="dis" icon={Ban}>
          Disabled
        </Badge>
      );
  }
}
