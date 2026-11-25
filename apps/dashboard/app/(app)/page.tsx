import classNames from "classnames";
import { ArrowRight, ChartColumn, Check, OctagonX } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { DailyUsage } from "@/components/DailyUsage";
import { EndpointState } from "@/components/EndpointState";
import { GetStarted } from "@/components/GetStarted";
import { LocalTime } from "@/components/LocalTime";
import { TopBar } from "@/components/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import { apiGet } from "@/lib/api";
import type { DeliveryPage } from "@/lib/deliveries";
import { type Endpoint, endpointName } from "@/lib/endpoints";
import { type Onboarding, onboardingDone } from "@/lib/onboarding";
import { RANGE_LABELS, type Stats, toRange } from "@/lib/stats";
import type { Usage } from "@/lib/usage";
import { DeliveryChart } from "./DeliveryChart";
import { RangeSwitch } from "./RangeSwitch";

export const metadata: Metadata = { title: "Overview · Webhooks" };

type SearchParams = Promise<{ range?: string }>;

export default function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TopBar title="Overview" subtitle="Your webhooks at a glance" />
      <Suspense fallback={<LoadingOverview />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const range = toRange((await searchParams).range);
  // The numbers and chart, the endpoints (for the ones stopped), and the latest deliveries that
  // died, all asked for at the same time.
  const [stats, { endpoints }, { deliveries: died }, usage, onboarding] = await Promise.all([
    apiGet<Stats>(`/api/stats?range=${range}`),
    apiGet<{ endpoints: Endpoint[] }>("/api/endpoints"),
    apiGet<DeliveryPage>("/api/deliveries?state=dead&limit=5"),
    apiGet<Usage>("/api/usage"),
    apiGet<Onboarding>("/api/onboarding"),
  ]);
  const { succeeded, dead, pending } = stats.deliveries;
  const made = succeeded + dead + pending;
  const finished = succeeded + dead;
  const stopped = endpoints.filter((endpoint) => endpoint.state !== "active");
  // A workspace that hasn't got going yet: no webhook has ever arrived, and nothing happened in
  // this range. Its numbers are all 0, so the page shows the way to start instead of empty charts.
  const fresh = !onboarding.steps.delivered && made === 0;
  const requestHeaders = await headers();
  const origin = `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;

  return (
    <>
      {!onboardingDone(onboarding) && <GetStarted onboarding={onboarding} origin={origin} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">In {RANGE_LABELS[range]}</h2>
        <RangeSwitch value={range} />
      </div>

      <section
        aria-label="Numbers"
        className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3"
      >
        <Figure label="Events received" value={stats.events} faint={fresh}>
          sent by your code
        </Figure>
        <Figure label="Deliveries arrived" value={succeeded} faint={fresh}>
          {made === 0 ? "none made yet" : `of ${made.toLocaleString("en")} deliveries made`}
        </Figure>
        <Figure
          label="Failing now"
          value={stats.failing_now}
          href={fresh ? undefined : "/deliveries?state=pending"}
          faint={fresh}
        >
          being retried after a failure
        </Figure>
        <Figure
          label="In the dead-letter queue"
          value={stats.dead_in_dlq}
          href={fresh ? undefined : "/dlq"}
          faint={fresh}
        >
          gave up, waiting for you
        </Figure>
        <SuccessRate succeeded={succeeded} finished={finished} />
      </section>

      <Card aria-labelledby="usage-h" className="py-4">
        <h2 id="usage-h" className="sr-only">
          Today's events
        </h2>
        <DailyUsage usage={usage} />
      </Card>

      {fresh ? (
        <Card
          aria-labelledby="chart-h"
          className="flex flex-col items-center gap-2.5 px-6 py-12 text-center"
        >
          <ChartColumn aria-hidden className="size-7 text-fg-3" />
          <h2 id="chart-h" className="text-[15px] font-semibold">
            No deliveries yet
          </h2>
          <p className="max-w-sm text-fg-2">
            Your chart, failures and success rate show up here once your first event goes out.
          </p>
        </Card>
      ) : (
        <>
          <Card aria-labelledby="chart-h">
            <h2 id="chart-h" className="text-[15px] font-semibold">
              Deliveries over time
            </h2>
            <p className="mb-4 text-fg-3">
              Deliveries made in each {stepName(stats.step_seconds)}, by how they ended so far.
            </p>
            <DeliveryChart stats={stats} />
          </Card>

          <div className="flex flex-wrap items-start gap-5">
            <NeedsAttention stopped={stopped} dead={stats.dead_in_dlq} />
            <LatestDied died={died} />
          </div>
        </>
      )}
    </>
  );
}

// One number card. With href, the whole card links to the page that lists them. faint: a new
// workspace's zeros, shown quietly.
function Figure({
  label,
  value,
  href,
  faint = false,
  children,
}: {
  label: string;
  value: number;
  href?: string;
  faint?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <p className="text-[13px] text-fg-2">{label}</p>
      <p
        className={classNames(
          "mt-1 text-[28px] leading-tight font-semibold tabular-nums",
          faint && "text-fg-3",
        )}
      >
        {value.toLocaleString("en")}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-fg-3">
        {children}
        {href && <ArrowRight aria-hidden className="size-3.5" />}
      </p>
    </>
  );
  return (
    <Card className="px-4 py-3.5">
      {href ? (
        <Link href={href} className="block hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

// The share of finished deliveries that arrived, to one decimal, with a bar. Deliveries still
// being retried aren't counted until they finish. "—" before any has finished.
function SuccessRate({ succeeded, finished }: { succeeded: number; finished: number }) {
  const rate = finished === 0 ? null : (succeeded / finished) * 100;
  return (
    <Card className="border-accent-line! bg-[radial-gradient(260px_160px_at_100%_0%,var(--accent-soft),transparent_70%)] px-4 py-3.5">
      <p className="text-[13px] text-fg-2">Success rate</p>
      <p
        className={classNames(
          "mt-1 text-[28px] leading-tight font-semibold tabular-nums",
          rate === null ? "text-fg-3" : "text-accent",
        )}
      >
        {rate === null ? "—" : `${rate.toFixed(1)}%`}
      </p>
      {rate === null ? (
        <p className="mt-1 text-[13px] text-fg-3">none finished yet</p>
      ) : (
        <Meter
          value={succeeded}
          max={finished}
          label="Finished deliveries that arrived"
          className="mt-3"
        />
      )}
    </Card>
  );
}

// Endpoints that aren't sending, and the dead-letter queue when it has anything: each a row with
// what it is, one line on why, and its state as a badge.
function NeedsAttention({ stopped, dead }: { stopped: Endpoint[]; dead: number }) {
  const count = stopped.length + (dead > 0 ? 1 : 0);
  return (
    <Card aria-labelledby="attention-h" className="flex-[1_1_320px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="attention-h" className="text-[15px] font-semibold">
          Needs attention
        </h2>
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>
      {count === 0 ? (
        <p className="flex items-center gap-2 text-fg-2">
          <Check aria-hidden className="size-4 text-ok" />
          Nothing right now: every endpoint is receiving, and the dead-letter queue is empty.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {stopped.map((endpoint) => (
            <AttentionRow
              key={endpoint.id}
              href={`/endpoints/${endpoint.id}`}
              name={endpointName(endpoint)}
              detail={
                endpoint.state === "disabled"
                  ? "Stopped after too many failures; tested now and then"
                  : "Paused; its deliveries wait until you resume it"
              }
              badge={<EndpointState state={endpoint.state} />}
            />
          ))}
          {dead > 0 && (
            <AttentionRow
              href="/dlq"
              name="Dead-letter queue"
              detail="Redeliver or discard"
              badge={
                <Badge tone="dead" icon={OctagonX}>
                  {dead.toLocaleString("en")} dead
                </Badge>
              }
            />
          )}
        </ul>
      )}
    </Card>
  );
}

function AttentionRow({
  href,
  name,
  detail,
  badge,
}: {
  href: string;
  name: string;
  detail: string;
  badge: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-inset border border-line bg-card-2 px-3.5 py-3 hover:bg-card-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="block text-[12.5px] text-fg-3">{detail}</span>
        </span>
        {badge}
      </Link>
    </li>
  );
}

function LatestDied({ died }: { died: DeliveryPage["deliveries"] }) {
  return (
    <Card aria-labelledby="died-h" className="flex-[1_1_380px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="died-h" className="text-[15px] font-semibold">
          Latest that died
        </h2>
        <Link href="/deliveries?state=dead" className="text-[13px] text-fg-2 hover:underline">
          All dead deliveries
        </Link>
      </div>
      {died.length === 0 ? (
        <p className="text-fg-2">No delivery has died.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {died.map((delivery) => (
            <li key={delivery.id}>
              <Link
                href={`/deliveries/${delivery.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-card-2"
              >
                <Tag>{delivery.event_type ?? "unknown"}</Tag>
                <span className="min-w-0 flex-1 truncate">
                  to{" "}
                  {delivery.endpoint_description || delivery.endpoint_url || "a deleted endpoint"}
                </span>
                <span className="font-mono text-[12.5px] text-fg-2">{delivery.failure_reason}</span>
                <span className="text-[13px] text-fg-3">
                  <LocalTime iso={delivery.finished_at ?? delivery.created_at} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function stepName(seconds: number): string {
  if (seconds === 300) {
    return "5 minutes";
  }
  return seconds === 3600 ? "hour" : "6 hours";
}

function LoadingOverview() {
  return (
    <section aria-busy="true" aria-label="Loading overview" className="flex flex-col gap-5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-80 w-full rounded-card" />
    </section>
  );
}
