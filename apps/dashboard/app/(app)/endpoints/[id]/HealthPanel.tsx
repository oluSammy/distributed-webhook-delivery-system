"use client";

import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { EndpointHealth } from "@/lib/endpoints";

const REFRESH_SECONDS = 15;

const HEALTH: Record<EndpointHealth["health"], { label: string; tone: BadgeTone }> = {
  healthy: { label: "Healthy", tone: "ok" },
  degraded: { label: "Degraded", tone: "fail" },
  disabled: { label: "Disabled", tone: "dis" },
  paused: { label: "Paused", tone: "pause" },
};

const BREAKER: Record<NonNullable<EndpointHealth["limiter"]>["breaker"], string> = {
  closed: "Closed: sending normally",
  open: "Open: not sending, after too many failures",
  half_open: "Testing: one probe at a time",
};

// The Health tab: what the endpoint's limiter knows right now, asked for every 15 seconds while
// the tab is open. It reads live state, so it isn't part of the page sent from the server.
export function HealthPanel({ endpointId }: { endpointId: string }) {
  const [health, setHealth] = useState<EndpointHealth | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/health`);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      setHealth((await response.json()) as EndpointHealth);
      setUpdatedAt(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [endpointId]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_SECONDS * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  if (!health) {
    return failed ? (
      <p className="text-fg-2">Couldn't load its health. Trying again shortly.</p>
    ) : (
      <Skeleton className="h-40 w-full rounded-card" />
    );
  }
  const limiter = health.limiter;
  const status = HEALTH[health.health];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-fg-3">
        <span aria-live="polite">
          Live · updated {updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : 0} s ago ·
          refreshes every {REFRESH_SECONDS} s{failed && " · the last refresh failed"}
        </span>
        <Button size="sm" onClick={load}>
          <RefreshCw aria-hidden />
          Refresh
        </Button>
      </div>
      <section
        aria-label="Live health"
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]"
      >
        <Fact label="Health">
          <Badge tone={status.tone}>{status.label}</Badge>
          {health.probe_at && (
            <p className="mt-1 text-[12.5px] text-fg-3">
              Next test delivery at <LocalTime iso={health.probe_at} />
            </p>
          )}
        </Fact>
        {limiter === null ? (
          <Fact label="Limits">
            <p className="text-fg-2">
              Live limits can't be read right now. Delivery isn't affected.
            </p>
          </Fact>
        ) : (
          <>
            <Fact label="Sending rate">
              <Big value={limiter.current_rate_per_s} of={`${limiter.rate_limit_per_s} / s`} />
              {limiter.current_rate_per_s < limiter.rate_limit_per_s && (
                <p className="mt-1 text-[12.5px] text-fg-3">Recovering after it was throttled</p>
              )}
            </Fact>
            <Fact label="Being sent now">
              <Big value={limiter.slots_in_use} of={`${limiter.concurrency_limit} at once`} />
            </Fact>
            <Fact label="Throttled">
              {limiter.throttled_until ? (
                <p>
                  Until <LocalTime iso={limiter.throttled_until} />
                </p>
              ) : (
                <p className="text-fg-2">No</p>
              )}
            </Fact>
            <Fact label="Circuit breaker">
              <p>{BREAKER[limiter.breaker]}</p>
              <p className="mt-1 text-[12.5px] text-fg-3">
                {limiter.recent_failures} of {limiter.recent_attempts} attempts failed in the last
                10 minutes
              </p>
            </Fact>
          </>
        )}
      </section>
      {limiter && (
        <p className="text-[12.5px] text-fg-3">
          The rate, slots and breaker are what the endpoint's limiter has seen since it last
          started, so they can read low just after a restart.
        </p>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1.5 px-4 py-3.5">
      <p className="text-[13px] text-fg-2">{label}</p>
      <div className="font-medium">{children}</div>
    </Card>
  );
}

// "25 of 50 / s": the number large, its limit beside it.
function Big({ value, of }: { value: number; of: string }) {
  return (
    <p className="tabular-nums">
      <span className="text-xl font-semibold">{value.toLocaleString("en")}</span>{" "}
      <span className="text-fg-3">of {of}</span>
    </p>
  );
}
