import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { apiGet } from "@/lib/api";
import type { EventType } from "@/lib/event-types";
import { EventTypes } from "../EventTypes";
import { SettingsHeader } from "../SettingsHeader";
import { SettingsLoading } from "../SettingsLoading";

export const metadata: Metadata = { title: "Event types · Settings · Webhooks" };

export default function EventTypesSettingsPage() {
  return (
    <>
      <SettingsHeader section="event-types" />
      <Suspense fallback={<SettingsLoading />}>
        <Types />
      </Suspense>
    </>
  );
}

// The types your code may send. Anyone in the workspace can add or remove them.
async function Types() {
  const { event_types } = await apiGet<{ event_types: EventType[] }>("/api/event-types");
  return (
    <Card aria-labelledby="types-h">
      <h2 id="types-h" className="text-[15px] font-semibold">
        Event types
      </h2>
      <p className="mb-4 max-w-xl text-fg-3">
        The types your code may send. An endpoint receives the ones its subscriptions match.
      </p>
      <EventTypes types={event_types} />
    </Card>
  );
}
