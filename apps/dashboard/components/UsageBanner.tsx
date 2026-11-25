import { Ban, Gauge } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { apiGet } from "@/lib/api";
import { type Usage, usageLevel, usagePercent } from "@/lib/usage";

// Shown above every page from 80% of today's event limit, and at the limit. Nothing below 80%, or
// if the usage can't be read: a missing warning shouldn't stop the page from showing.
export async function UsageBanner() {
  const usage = await apiGet<Usage>("/api/usage").catch(() => null);
  if (!usage) {
    return null;
  }
  const level = usageLevel(usage);
  if (level === "ok") {
    return null;
  }
  const limit = usage.daily_limit.toLocaleString("en");
  const details = (
    <Link href="/settings/usage" className="font-medium underline">
      Usage
    </Link>
  );
  if (level === "full") {
    return (
      <Banner tone="dead" icon={Ban} action={details}>
        <strong>Today's limit of {limit} events is reached.</strong> New events are refused (429)
        until 00:00 UTC. Events already received are still delivered.
      </Banner>
    );
  }
  return (
    <Banner tone="fail" icon={Gauge} action={details}>
      <strong>
        {usagePercent(usage)}% of today's {limit} events used.
      </strong>{" "}
      At the limit, new events are refused until 00:00 UTC.
    </Banner>
  );
}
