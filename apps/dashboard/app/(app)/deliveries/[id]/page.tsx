import { ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { DeliveryState } from "@/components/DeliveryState";
import { FindById } from "@/components/FindById";
import { LocalTime } from "@/components/LocalTime";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { ShortId } from "@/components/ui/ShortId";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { apiGet } from "@/lib/api";
import type { DeliveryDetail } from "@/lib/deliveries";
import { reasonLabel } from "@/lib/dlq";
import { plural } from "@/lib/format";
import type { RetryPolicy } from "@/lib/retry-policy";
import { AttemptTimeline } from "./AttemptTimeline";
import { Countdown } from "./Countdown";
import { DeliveryActions } from "./DeliveryActions";

export const metadata: Metadata = { title: "Delivery · Webhooks" };

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DeliveryPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<LoadingDelivery />}>
      <Delivery params={params} />
    </Suspense>
  );
}

async function Delivery({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }
  // The delivery, and the retry policy (for "1 of 10 failures used" and how long a wait can be).
  const [delivery, policy] = await Promise.all([
    apiGet<DeliveryDetail>(`/api/deliveries/${id}`),
    apiGet<RetryPolicy>("/api/retry-policy"),
  ]);
  const endpointName = delivery.endpoint_description || delivery.endpoint_url || "Deleted endpoint";

  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b border-line pt-1 pb-4">
        <div className="mr-auto flex min-w-0 flex-col gap-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Link href="/deliveries" className="text-fg-2 hover:underline">
              Deliveries
            </Link>
            <ChevronRight aria-hidden className="size-3.5" />
            <span aria-current="page">
              <ShortId id={delivery.id} label="delivery id" />
            </span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <DeliveryState delivery={delivery} />
            <h1 className="font-mono text-xl font-semibold">
              {delivery.event_type ?? "unknown event"}
            </h1>
            <span className="text-fg-2">to</span>
            <Link
              href={`/endpoints/${delivery.endpoint_id}`}
              title={delivery.endpoint_url ?? undefined}
              className="text-base font-semibold text-accent hover:underline"
            >
              {endpointName}
            </Link>
          </div>
          <p className="text-fg-2">{summary(delivery)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitch />
          <FindById />
          <DeliveryActions delivery={delivery} />
        </div>
      </header>

      <section
        aria-label="Delivery facts"
        className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]"
      >
        <Fact label="Created">
          <LocalTime iso={delivery.created_at} />
        </Fact>
        <Fact label="Finished">
          {delivery.finished_at ? <LocalTime iso={delivery.finished_at} /> : "Not yet"}
        </Fact>
        <Fact label="Attempts">
          {delivery.attempt_count.toLocaleString("en")} failed
          {delivery.throttled_count > 0 && ` · ${delivery.throttled_count} throttled`}
        </Fact>
        <Fact label="Event">
          <ShortId id={delivery.event_id} label="event id" />
        </Fact>
        {delivery.state === "pending" && (
          <Fact label="Next attempt">
            <NextAttemptFact delivery={delivery} policy={policy} />
          </Fact>
        )}
        {delivery.state === "dead" && (
          <Fact label="Why it died">
            <WhyItDied delivery={delivery} />
          </Fact>
        )}
        {delivery.redelivered_from && (
          <Fact label="Redelivery of">
            <Link
              href={`/deliveries/${delivery.redelivered_from}`}
              className="text-accent hover:underline"
            >
              <span className="font-mono text-[12.5px]">
                {delivery.redelivered_from.slice(0, 8)}…
              </span>
            </Link>
          </Fact>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <Card aria-labelledby="timeline-h" className="min-w-0 flex-[3_1_560px]">
          <h2 id="timeline-h" className="mb-4 text-[15px] font-semibold">
            Attempt timeline
          </h2>
          <AttemptTimeline delivery={delivery} policy={policy} />
        </Card>
        <Card aria-labelledby="sent-h" className="flex min-w-0 flex-[2_1_380px] flex-col gap-4">
          <h2 id="sent-h" className="text-[15px] font-semibold">
            What was sent
          </h2>
          <WhatWasSent delivery={delivery} />
        </Card>
      </div>

      {delivery.other_deliveries.length > 0 && (
        <Card aria-labelledby="others-h">
          <h2 id="others-h" className="text-[15px] font-semibold">
            Other deliveries of this event
          </h2>
          <p className="mt-1 mb-4 text-fg-3">The same event, to your other endpoints.</p>
          <Table label="Other deliveries of this event">
            <thead>
              <tr>
                <Th>Endpoint</Th>
                <Th>State</Th>
                <Th align="right">Attempts</Th>
                <Th>Last status or error</Th>
                <Th align="right">
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {delivery.other_deliveries.map((other) => (
                <tr key={other.id}>
                  <Td>{other.endpoint_description || other.endpoint_url}</Td>
                  <Td>
                    <DeliveryState delivery={other} />
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {other.attempt_count}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px]">
                      {other.last_status ?? other.last_error_kind ?? "—"}
                    </span>
                  </Td>
                  <Td align="right">
                    <Button size="sm" asChild>
                      <Link href={`/deliveries/${other.id}`}>Open</Link>
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

// What happened, in one sentence.
function summary(delivery: DeliveryDetail): string {
  const failed = plural(delivery.attempt_count, "failed attempt");
  switch (delivery.state) {
    case "succeeded":
      return delivery.attempt_count === 0
        ? "Delivered on the first try."
        : `Delivered after ${failed}.`;
    case "cancelled":
      return "Cancelled before it was delivered.";
    case "dead": {
      const why =
        {
          max_attempts: `Gave up after ${failed}.`,
          max_age: "Gave up: it reached the retry policy's maximum age.",
          gone: "The endpoint answered 410 Gone, which means stop sending, so it wasn't retried.",
          url_not_allowed: "The endpoint's URL isn't allowed, so it was never sent.",
        }[delivery.failure_reason ?? ""] ?? `Gave up: ${delivery.failure_reason}.`;
      const resolution =
        delivery.resolution === "redelivered"
          ? " It has been redelivered."
          : delivery.resolution === "discarded"
            ? " It was discarded."
            : " It's in the dead-letter queue.";
      return why + resolution;
    }
    case "pending":
      if (delivery.attempt_count === 0 && delivery.throttled_count === 0) {
        return delivery.next_attempt_at || delivery.in_flight
          ? "Waiting for its first attempt."
          : "Waiting: its endpoint is paused or disabled, so nothing is sent until it's back.";
      }
      return `Still trying: ${failed}${delivery.throttled_count ? ` and ${delivery.throttled_count} throttled` : ""} so far.`;
  }
}

function WhatWasSent({ delivery }: { delivery: DeliveryDetail }) {
  const last = delivery.attempts.at(-1);
  const headers: [string, string][] = [
    ["webhook-id", delivery.event_id],
    ["webhook-timestamp", last ? String(last.signed_timestamp) : "set when it's sent"],
    ["webhook-signature", "v1,… signed with this endpoint's secret"],
    ["webhook-attempt", last ? String(last.attempt_number) : "1"],
    ["content-type", "application/json"],
  ];
  return (
    <>
      <div>
        <p className="mb-2 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">Request</p>
        <p className="font-mono text-[12.5px] break-all">
          <span className="font-semibold text-accent">POST</span> {delivery.endpoint_url}
        </p>
      </div>
      <div>
        <p className="mb-2 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">
          Headers{last && `, attempt ${last.attempt_number}`}
        </p>
        <Table label="Headers">
          <tbody>
            {headers.map(([name, value]) => (
              <tr key={name}>
                <Td className="font-mono text-[12.5px] text-fg-3">{name}</Td>
                <Td className="font-mono text-[12.5px] break-all whitespace-normal">{value}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-1.5 text-[12.5px] text-fg-3">
          The webhook-id is the same on every attempt, so the receiver can skip duplicates.
        </p>
      </div>
      <div>
        {delivery.request_body === null ? (
          <p className="text-fg-2">The body is no longer kept: the event is past its retention.</p>
        ) : (
          <>
            <p className="mb-2 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">
              Body · {plural(new TextEncoder().encode(delivery.request_body).length, "byte")}
            </p>
            <CodeBlock
              code={JSON.stringify(JSON.parse(delivery.request_body), null, 2)}
              copyValue={delivery.request_body}
              language="json"
              copyLabel="Copy body exactly as sent"
            />
          </>
        )}
      </div>
      {delivery.state === "dead" && delivery.resolution === null && (
        <Banner tone="info" icon={Info}>
          Redeliver creates a new delivery of the same event, with a fresh set of attempts. This one
          stays as history, marked as redelivered.
        </Banner>
      )}
    </>
  );
}

// When a pending delivery is tried next: a countdown, the time, and how many of the allowed
// failures it has used. "Being sent now" while an attempt is in flight; parked ones wait for
// their endpoint, with no time.
function NextAttemptFact({ delivery, policy }: { delivery: DeliveryDetail; policy: RetryPolicy }) {
  const used = `${delivery.attempt_count} of ${policy.max_attempts} failures used`;
  if (delivery.in_flight) {
    return (
      <>
        Being sent now
        <span className="mt-0.5 block text-[12.5px] font-normal text-fg-3">{used}</span>
      </>
    );
  }
  if (!delivery.next_attempt_at) {
    return (
      <>
        When its endpoint is back
        <span className="mt-0.5 block text-[12.5px] font-normal text-fg-3">
          paused or disabled · {used}
        </span>
      </>
    );
  }
  return (
    <>
      <Countdown iso={delivery.next_attempt_at} />
      <span className="mt-0.5 block text-[12.5px] font-normal text-fg-3">
        at <LocalTime iso={delivery.next_attempt_at} /> · {used}
      </span>
    </>
  );
}

// Why a dead delivery died, in words, and where it is now: still in the dead-letter queue, or
// redelivered or discarded, and when.
function WhyItDied({ delivery }: { delivery: DeliveryDetail }) {
  const where =
    delivery.resolution === "redelivered"
      ? "Redelivered"
      : delivery.resolution === "discarded"
        ? "Discarded"
        : "In the dead-letter queue since";
  const when =
    delivery.resolution && delivery.resolved_at ? delivery.resolved_at : delivery.finished_at;
  return (
    <>
      {reasonLabel(delivery.failure_reason ?? "")}{" "}
      <span className="font-mono text-[12.5px] font-normal text-fg-3">
        {delivery.failure_reason}
      </span>
      <span className="mt-0.5 block text-[12.5px] font-normal text-fg-3">
        {where} {when && <LocalTime iso={when} />}
      </span>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-1 font-medium">{children}</p>
    </Card>
  );
}

function LoadingDelivery() {
  return (
    <section aria-busy="true" aria-label="Loading delivery" className="flex flex-col gap-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-80" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-96 w-full rounded-card" />
    </section>
  );
}
