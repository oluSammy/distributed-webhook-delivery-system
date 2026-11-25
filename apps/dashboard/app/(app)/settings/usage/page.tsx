import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyUsage } from "@/components/DailyUsage";
import { Card } from "@/components/ui/Card";
import { apiGet } from "@/lib/api";
import type { Usage } from "@/lib/usage";
import { SettingsHeader } from "../SettingsHeader";
import { SettingsLoading } from "../SettingsLoading";

export const metadata: Metadata = { title: "Usage & limits · Settings · Webhooks" };

export default function UsageSettingsPage() {
  return (
    <>
      <SettingsHeader section="usage" />
      <Suspense fallback={<SettingsLoading />}>
        <UsageAndLimits />
      </Suspense>
    </>
  );
}

const code = "font-mono text-[12.5px]";

// Today's events against the daily limit, how the limit works, and the API's other limits.
async function UsageAndLimits() {
  const usage = await apiGet<Usage>("/api/usage");
  return (
    <Card aria-labelledby="usage-h">
      <h2 id="usage-h" className="text-[15px] font-semibold">
        Events today
      </h2>
      <p className="mb-4 max-w-xl text-fg-3">
        Every workspace may send {usage.daily_limit.toLocaleString("en")} events a day (UTC).
      </p>
      <DailyUsage usage={usage} />
      <ul className="mt-4 flex max-w-2xl list-disc flex-col gap-1 pl-5 text-fg-2">
        <li>
          At the limit, <code className={code}>POST /api/events</code> answers{" "}
          <code className={code}>429</code> with <code className={code}>Retry-After</code>, the
          seconds until 00:00 UTC. A batch that would go over is refused whole.
        </li>
        <li>
          Every accepted event's answer says what's left:{" "}
          <code className={code}>RateLimit-Remaining</code>.
        </li>
        <li>Repeats of an Idempotency-Key, and refused requests, don't count.</li>
      </ul>
      {/* The same limits the API checks (apps/api/src/routes/events.ts and endpoints.ts). */}
      <p className="mt-5 max-w-2xl rounded-inset border border-line bg-card-2 px-3.5 py-3 text-[13px] text-fg-2">
        <span className="font-medium text-fg">Other limits:</span> a request body up to 256 KB · up
        to 500 events in one batch · up to 50 subscriptions per endpoint.
      </p>
    </Card>
  );
}
