"use client";

import Link from "next/link";
import { useState } from "react";
import { EventDeliveries } from "@/components/EventDeliveries";
import { LocalTime } from "@/components/LocalTime";
import { Button } from "@/components/ui/Button";
import { ShortId } from "@/components/ui/ShortId";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { useToast } from "@/components/ui/Toast";
import { type EventPage, eventsPath } from "@/lib/events";

// The events table. The first page comes from the server; "Load more" fetches the next in the
// browser and adds it below.
export function EventList({ first, type }: { first: EventPage; type: string | null }) {
  const toast = useToast();
  const [rows, setRows] = useState(first.events);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(eventsPath(type, cursor));
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const next = (await response.json()) as EventPage;
      setRows((current) => [...current, ...next.events]);
      setCursor(next.next_cursor);
    } catch {
      toast("Couldn't load more events. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Table label="Events">
        <thead>
          <tr>
            <Th>Received</Th>
            <Th>Type</Th>
            <Th>Event</Th>
            <Th>Deliveries</Th>
            <Th align="right">
              <span className="sr-only">Open</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr key={event.id}>
              <Td>
                <LocalTime iso={event.created_at} />
              </Td>
              <Td>
                <Tag>{event.type}</Tag>
              </Td>
              <Td>
                <ShortId id={event.id} label="event id" />
              </Td>
              <Td>
                <EventDeliveries event={event} />
              </Td>
              <Td align="right">
                <Button size="sm" asChild>
                  <Link href={`/events/${event.id}`}>Open</Link>
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex items-center justify-between gap-3 text-fg-3">
        <span className="tabular-nums">
          Showing {rows.length.toLocaleString("en")} · newest first
        </span>
        {cursor && (
          <Button onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}
