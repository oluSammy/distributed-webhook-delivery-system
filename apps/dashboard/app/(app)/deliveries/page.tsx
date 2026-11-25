import { Send, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";
import {
  type DeliveryFilters,
  type DeliveryPage,
  deliveriesPage,
  deliveriesPath,
  toFilters,
} from "@/lib/deliveries";
import { DeliveryList } from "./DeliveryList";
import { DeliverySearch } from "./DeliverySearch";
import { StateFilter } from "./StateFilter";

export const metadata: Metadata = { title: "Deliveries · Webhooks" };

type SearchParams = Promise<{ state?: string; endpoint_id?: string; event_id?: string }>;

export default function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TopBar
        title="Deliveries"
        subtitle="One event going to one endpoint · newest first"
        search={<DeliverySearch />}
      />
      {/* The list depends on who's signed in and on the filters in the address, so it streams in
          per request; the grey rows show meanwhile. */}
      <Suspense fallback={<LoadingDeliveries />}>
        <Deliveries searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Deliveries({ searchParams }: { searchParams: SearchParams }) {
  const filters = toFilters(await searchParams);
  const first = await apiGet<DeliveryPage>(deliveriesPath(filters));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StateFilter filters={filters} />
        <ActiveFilters filters={filters} first={first} />
      </div>
      {first.deliveries.length > 0 ? (
        // key: new filters start a new list, not more rows added to the old one.
        <DeliveryList key={deliveriesPage(filters)} first={first} filters={filters} />
      ) : (
        <NoDeliveries filters={filters} />
      )}
    </>
  );
}

// A chip for each endpoint or event filter, with an × that removes it. The endpoint's name comes
// from the first row, so it costs no request; with no rows, its short id stands in.
function ActiveFilters({ filters, first }: { filters: DeliveryFilters; first: DeliveryPage }) {
  const row = first.deliveries[0];
  const endpointName = row
    ? row.endpoint_description || row.endpoint_url || "Deleted endpoint"
    : `${filters.endpointId?.slice(0, 8)}…`;
  return (
    <>
      {filters.endpointId && (
        <FilterChip
          label={`Endpoint: ${endpointName}`}
          removeHref={deliveriesPage({ ...filters, endpointId: null })}
        />
      )}
      {filters.eventId && (
        <FilterChip
          label={`Event: ${filters.eventId.slice(0, 8)}…`}
          removeHref={deliveriesPage({ ...filters, eventId: null })}
        />
      )}
    </>
  );
}

function FilterChip({ label, removeHref }: { label: string; removeHref: string }) {
  return (
    <span className="inline-flex h-[34px] items-center gap-1 rounded-full border border-accent-line bg-accent-soft pr-1 pl-3.5 text-[13px]">
      <span className="max-w-60 truncate">{label}</span>
      <Link
        href={removeHref}
        aria-label={`Remove filter ${label}`}
        className="inline-flex size-6.5 items-center justify-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
      >
        <X aria-hidden className="size-3.5" />
      </Link>
    </span>
  );
}

function NoDeliveries({ filters }: { filters: DeliveryFilters }) {
  const filtered = filters.state !== "all" || filters.endpointId || filters.eventId;
  // A test goes to one endpoint: straight to it when the list is filtered to one.
  const testHref = filters.endpointId ? `/endpoints/${filters.endpointId}` : "/endpoints";
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
      <Send aria-hidden className="size-6 text-fg-3" />
      <h2 className="text-[15px] font-semibold">
        {filtered ? "No deliveries match these filters" : "No deliveries yet"}
      </h2>
      <p className="max-w-md text-fg-2">
        {filtered
          ? "Try another state, or clear the filters. Deliveries are made when an event matches an endpoint's subscriptions."
          : "A delivery is made when an event matches an endpoint's subscriptions. Send an event to see one here."}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {filtered && (
          <Button asChild>
            <Link href="/deliveries">Clear filters</Link>
          </Button>
        )}
        <Button variant="primary" asChild>
          <Link href={testHref}>Send a test event</Link>
        </Button>
      </div>
    </Card>
  );
}

function LoadingDeliveries() {
  return (
    <Card aria-busy="true" aria-label="Loading deliveries" className="flex flex-col gap-3">
      {Array.from({ length: 8 }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows that never reorder
        <div key={row} className="flex items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="hidden h-4 w-16 md:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
      ))}
    </Card>
  );
}
