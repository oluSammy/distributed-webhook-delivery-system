import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { DeliveryState } from "@/components/DeliveryState";
import { LocalTime } from "@/components/LocalTime";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { ShortId } from "@/components/ui/ShortId";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { apiGet } from "@/lib/api";
import type { DeliveryPage } from "@/lib/deliveries";
import type { EventDetail } from "@/lib/events";

export const metadata: Metadata = { title: "Event · Webhooks" };

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EventPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<LoadingEvent />}>
      <EventView params={params} />
    </Suspense>
  );
}

async function EventView({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }
  // The event and its deliveries (one per endpoint it matched), asked for at the same time.
  const [event, { deliveries }] = await Promise.all([
    apiGet<EventDetail>(`/api/events/${id}`),
    apiGet<DeliveryPage>(`/api/deliveries?event_id=${id}&limit=100`),
  ]);
  const payload = JSON.stringify(event.payload, null, 2);

  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b border-line pt-1 pb-4">
        <div className="mr-auto flex min-w-0 flex-col gap-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Link href="/events" className="text-fg-2 hover:underline">
              Events
            </Link>
            <ChevronRight aria-hidden className="size-3.5" />
            <span aria-current="page">
              <ShortId id={event.id} label="event id" />
            </span>
          </nav>
          <h1 className="font-mono text-xl font-semibold">{event.type}</h1>
        </div>
        <ThemeSwitch />
      </header>

      <section
        aria-label="Event facts"
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]"
      >
        <Fact label="Received">
          <LocalTime iso={event.created_at} />
        </Fact>
        <Fact label="Deliveries made">
          {event.deliveries_created_at ? (
            <LocalTime iso={event.deliveries_created_at} />
          ) : (
            "Not yet: being made now"
          )}
        </Fact>
        <Fact label="Event">
          <ShortId id={event.id} label="event id" />
        </Fact>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <Card aria-labelledby="payload-h" className="min-w-0 flex-[2_1_380px]">
          <h2 id="payload-h" className="mb-3 text-[15px] font-semibold">
            Payload
          </h2>
          <CodeBlock code={payload} language="json" copyLabel="Copy payload" />
        </Card>
        <Card aria-labelledby="deliveries-h" className="min-w-0 flex-[3_1_480px]">
          <h2 id="deliveries-h" className="mb-1 text-[15px] font-semibold">
            Deliveries
          </h2>
          <p className="mb-4 text-fg-3">One for each endpoint whose subscriptions matched.</p>
          {deliveries.length === 0 ? (
            <p className="text-fg-2">
              {event.deliveries_created_at
                ? "No endpoint was subscribed to this type when it arrived."
                : "Its deliveries are being made. Reload in a moment."}
            </p>
          ) : (
            <Table label="Deliveries of this event">
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
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <Td>
                      <Link
                        href={`/endpoints/${delivery.endpoint_id}`}
                        title={delivery.endpoint_url ?? undefined}
                        className="font-medium hover:underline"
                      >
                        {delivery.endpoint_description ||
                          delivery.endpoint_url ||
                          "Deleted endpoint"}
                      </Link>
                    </Td>
                    <Td>
                      <DeliveryState delivery={delivery} />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {delivery.attempt_count}
                    </Td>
                    <Td>
                      <span className="font-mono text-[12.5px]">
                        {delivery.last_status ?? delivery.last_error_kind ?? "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <Button size="sm" asChild>
                        <Link href={`/deliveries/${delivery.id}`}>Open</Link>
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
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

function LoadingEvent() {
  return (
    <section aria-busy="true" aria-label="Loading event" className="flex flex-col gap-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-80 w-full rounded-card" />
    </section>
  );
}
