import { Zap } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { FindById } from "@/components/FindById";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";
import type { EventType } from "@/lib/event-types";
import { type EventPage, eventsPath } from "@/lib/events";
import { EventList } from "./EventList";
import { TypeFilter } from "./TypeFilter";

export const metadata: Metadata = { title: "Events · Webhooks" };

type SearchParams = Promise<{ type?: string }>;

export default function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TopBar
        title="Events"
        subtitle="What your code reported · newest first"
        search={<FindById placeholder="Search by event id" />}
      />
      <Suspense fallback={<LoadingEvents />}>
        <Events searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Events({ searchParams }: { searchParams: SearchParams }) {
  const { type = null } = await searchParams;
  const [first, { event_types }] = await Promise.all([
    apiGet<EventPage>(eventsPath(type)),
    apiGet<{ event_types: EventType[] }>("/api/event-types"),
  ]);
  return (
    <>
      <TypeFilter value={type} types={event_types.map((t) => t.name)} />
      {first.events.length > 0 ? (
        <EventList key={type} first={first} type={type} />
      ) : (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Zap aria-hidden className="size-6 text-fg-3" />
          <h2 className="text-[15px] font-semibold">
            {type ? `No ${type} events` : "No events yet"}
          </h2>
          <p className="max-w-md text-fg-2">
            {type
              ? "Check the type's spelling, or show every type."
              : "Events arrive when your code sends them with POST /api/events and one of your API keys."}
          </p>
        </Card>
      )}
    </>
  );
}

function LoadingEvents() {
  return (
    <section aria-busy="true" aria-label="Loading events" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-96 w-full rounded-inset" />
    </section>
  );
}
