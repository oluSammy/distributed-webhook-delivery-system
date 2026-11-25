import { Ban, ChevronRight, CirclePause } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { DeliveryState } from "@/components/DeliveryState";
import { EndpointState } from "@/components/EndpointState";
import { FindById } from "@/components/FindById";
import { LocalTime } from "@/components/LocalTime";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { ShortId } from "@/components/ui/ShortId";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";
import { Tag } from "@/components/ui/Tag";
import { apiGet } from "@/lib/api";
import type { DeliveryPage } from "@/lib/deliveries";
import { type Endpoint, endpointName, successRate } from "@/lib/endpoints";
import { EditEndpoint } from "./EditEndpoint";
import { EndpointActions } from "./EndpointActions";
import { HealthPanel } from "./HealthPanel";
import { SecretsPanel } from "./SecretsPanel";

export const metadata: Metadata = { title: "Endpoint · Webhooks" };

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EndpointPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<LoadingEndpoint />}>
      <EndpointView params={params} />
    </Suspense>
  );
}

async function EndpointView({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }
  // The endpoint and its newest deliveries, asked for at the same time.
  const [endpoint, recent] = await Promise.all([
    apiGet<Endpoint>(`/api/endpoints/${id}`),
    apiGet<DeliveryPage>(`/api/deliveries?endpoint_id=${id}&limit=10`),
  ]);
  const name = endpointName(endpoint);

  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b border-line pt-1 pb-4">
        <div className="mr-auto flex min-w-0 flex-col gap-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Link href="/endpoints" className="text-fg-2 hover:underline">
              Endpoints
            </Link>
            <ChevronRight aria-hidden className="size-3.5" />
            <span aria-current="page">{name}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">{name}</h1>
            <EndpointState state={endpoint.state} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-3">
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-[12.5px]">{endpoint.url}</span>
              <CopyButton value={endpoint.url} label="Copy URL" />
            </span>
            <span>
              Created <LocalTime iso={endpoint.created_at} />
            </span>
            <span className="inline-flex items-center gap-1">
              ID <ShortId id={endpoint.id} label="endpoint id" />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitch />
          <FindById />
          <EndpointActions endpoint={endpoint} />
        </div>
      </header>

      {endpoint.state === "disabled" && (
        <Banner tone="dis" icon={Ban}>
          <strong>Disabled by the circuit breaker.</strong> Too many deliveries failed, so sending
          stopped. New deliveries wait, and a test delivery goes out now and then: when one
          succeeds, sending starts again by itself.
        </Banner>
      )}
      {endpoint.state === "paused" && (
        <Banner tone="pause" icon={CirclePause}>
          <strong>Paused.</strong> Nothing is sent until you resume it. New deliveries wait, using
          up no attempts.
        </Banner>
      )}

      <Tabs defaultValue="overview">
        <TabList label="Endpoint sections">
          <Tab value="overview">Overview</Tab>
          <Tab value="health">Health</Tab>
          <Tab value="settings">Settings</Tab>
          <Tab value="secrets">Secrets</Tab>
        </TabList>
        <TabPanel value="overview" className="flex flex-col gap-5">
          <section
            aria-label="Last 24 hours"
            className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]"
          >
            <Fact label="Success, last 24 h">{successRate(endpoint) ?? "—"}</Fact>
            <Fact label="Arrived">{endpoint.deliveries_24h.succeeded.toLocaleString("en")}</Fact>
            <Fact label="Died">{endpoint.deliveries_24h.dead.toLocaleString("en")}</Fact>
            <Fact label="Still being retried">
              {endpoint.deliveries_24h.pending.toLocaleString("en")}
            </Fact>
          </section>
          <Card aria-labelledby="config-h">
            <h2 id="config-h" className="mb-3 text-[15px] font-semibold">
              Configuration
            </h2>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="text-fg-2">Subscriptions</dt>
              <dd className="flex flex-wrap gap-1.5">
                {endpoint.subscriptions.map((pattern) => (
                  <Tag key={pattern}>{pattern}</Tag>
                ))}
              </dd>
              <dt className="text-fg-2">Rate limit</dt>
              <dd className="tabular-nums">
                {endpoint.rate_limit_per_s.toLocaleString("en")} per second
              </dd>
              <dt className="text-fg-2">Sent at once</dt>
              <dd className="tabular-nums">{endpoint.concurrency_limit}</dd>
            </dl>
          </Card>
          <Card aria-labelledby="recent-h">
            <h2 id="recent-h" className="mb-4 text-[15px] font-semibold">
              Recent deliveries
            </h2>
            {recent.deliveries.length === 0 ? (
              <p className="text-fg-2">
                None yet. Send a test event, or wait for an event that matches its subscriptions.
              </p>
            ) : (
              <Table label="Recent deliveries">
                <thead>
                  <tr>
                    <Th>Created</Th>
                    <Th>Event type</Th>
                    <Th>State</Th>
                    <Th align="right">Attempts</Th>
                    <Th>Last status or error</Th>
                    <Th align="right">
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {recent.deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <Td>
                        <LocalTime iso={delivery.created_at} />
                      </Td>
                      <Td>
                        <Tag>{delivery.event_type ?? "unknown"}</Tag>
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
        </TabPanel>
        <TabPanel value="health">
          <HealthPanel endpointId={endpoint.id} />
        </TabPanel>
        <TabPanel value="settings">
          <EditEndpoint endpoint={endpoint} />
        </TabPanel>
        <TabPanel value="secrets">
          <SecretsPanel endpointId={endpoint.id} />
        </TabPanel>
      </Tabs>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{children}</p>
    </Card>
  );
}

function LoadingEndpoint() {
  return (
    <section aria-busy="true" aria-label="Loading endpoint" className="flex flex-col gap-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-72 w-full rounded-card" />
    </section>
  );
}
