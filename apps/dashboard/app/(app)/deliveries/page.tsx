import { Send } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";
import {
  type DeliveryPage,
  deliveriesPath,
  STATE_FILTERS,
  type StateFilter as Filter,
} from "@/lib/deliveries";
import { DeliveryList } from "./DeliveryList";
import { StateFilter } from "./StateFilter";

export const metadata: Metadata = { title: "Deliveries · Webhooks" };

type SearchParams = Promise<{ state?: string }>;

export default function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TopBar title="Deliveries" subtitle="One event going to one endpoint · newest first" />
      {/* The list depends on who's signed in and on ?state=, so it streams in per request; the
          grey rows show meanwhile. */}
      <Suspense fallback={<LoadingDeliveries />}>
        <Deliveries searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Deliveries({ searchParams }: { searchParams: SearchParams }) {
  const { state: requested } = await searchParams;
  const state: Filter = STATE_FILTERS.find((filter) => filter === requested) ?? "all";
  const first = await apiGet<DeliveryPage>(deliveriesPath(state));
  return (
    <>
      <StateFilter value={state} />
      {first.deliveries.length > 0 ? (
        // key: a new filter starts a new list, not more rows added to the old one.
        <DeliveryList key={state} first={first} state={state} />
      ) : (
        <NoDeliveries filtered={state !== "all"} />
      )}
    </>
  );
}

function NoDeliveries({ filtered }: { filtered: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
      <Send aria-hidden className="size-6 text-fg-3" />
      <h2 className="text-[15px] font-semibold">
        {filtered ? "No deliveries in this state" : "No deliveries yet"}
      </h2>
      <p className="max-w-md text-fg-2">
        {filtered
          ? "Try another state, or All."
          : "A delivery is made when an event matches an endpoint's subscriptions. Send an event to see one here."}
      </p>
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