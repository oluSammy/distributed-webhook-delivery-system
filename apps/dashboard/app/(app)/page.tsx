import { ArrowRight, Ban, Check, Inbox, Pause } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { DailyUsage } from "@/components/DailyUsage";
import { GetStarted } from "@/components/GetStarted";
import { LocalTime } from "@/components/LocalTime";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
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
  const { succeeded, dead } = stats.deliveries;
  const finished = succeeded + dead;
  const stopped = endpoints.filter((endpoint) => endpoint.state !== "active");
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
        className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]"
      >
        <Figure label="Events received" value={stats.events}>
          sent by your code
        </Figure>
        <Figure label="Deliveries arrived" value={succeeded}>
          {finished === 0
            ? "none finished yet"
            : `${((succeeded / finished) * 100).toFixed(1)}% of those that finished`}
        </Figure>
        <Figure label="Failing now" value={stats.failing_now} href="/deliveries?state=pending">
          being retried after a failure
        </Figure>
        <Figure label="In the dead-letter queue" value={stats.dead_in_dlq} href="/dlq">
          gave up, waiting for you
        </Figure>
      </section>

      <Card aria-labelledby="usage-h" className="py-4">
        <h2 id="usage-h" className="sr-only">
          Today's events
        </h2>
        <DailyUsage usage={usage} />
      </Card>

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
        <Card aria-labelledby="attention-h" className="flex-[1_1_320px]">
          <h2 id="attention-h" className="mb-3 text-[15px] font-semibold">
            Needs attention
          </h2>
          {stopped.length === 0 && stats.dead_in_dlq === 0 ? (
            <p className="flex items-center gap-2 text-fg-2">
              <Check aria-hidden className="size-4 text-ok" />
              Nothing right now: every endpoint is receiving, and the dead-letter queue is empty.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {stopped.map((endpoint) => (
                <Attention
                  key={endpoint.id}
                  href={`/endpoints/${endpoint.id}`}
                  icon={endpoint.state === "disabled" ? Ban : Pause}
                >
                  <strong className="font-medium">{endpointName(endpoint)}</strong>{" "}
                  {endpoint.state === "disabled"
                    ? "is disabled after too many failures; its deliveries wait until it recovers."
                    : "is paused; its deliveries wait until you resume it."}
                </Attention>
              ))}
              {stats.dead_in_dlq > 0 && (
                <Attention href="/dlq" icon={Inbox}>
                  <strong className="font-medium">
                    {stats.dead_in_dlq.toLocaleString("en")}{" "}
                    {stats.dead_in_dlq === 1 ? "delivery" : "deliveries"}
                  </strong>{" "}
                  in the dead-letter queue, to redeliver or discard.
                </Attention>
              )}
            </ul>
          )}
        </Card>

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
                      {delivery.endpoint_description ||
                        delivery.endpoint_url ||
                        "a deleted endpoint"}
                    </span>
                    <span className="font-mono text-[12.5px] text-fg-2">
                      {delivery.failure_reason}
                    </span>
                    <span className="text-[13px] text-fg-3">
                      <LocalTime iso={delivery.finished_at ?? delivery.created_at} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

// One number card. With href, the whole card links to the page that lists them.
function Figure({
  label,
  value,
  href,
  children,
}: {
  label: string;
  value: number;
  href?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-1 text-[28px] leading-tight font-semibold">{value.toLocaleString("en")}</p>
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

function Attention({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Ban;
  children: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-2.5 py-2.5 hover:bg-card-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" />
        <span>{children}</span>
      </Link>
    </li>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-80 w-full rounded-card" />
    </section>
  );
}
