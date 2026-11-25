"use client";

import Link from "next/link";
import { useState } from "react";
import { DeliveryState } from "@/components/DeliveryState";
import { LocalTime } from "@/components/LocalTime";
import { NextAttempt } from "@/components/NextAttempt";
import { Button } from "@/components/ui/Button";
import { ShortId } from "@/components/ui/ShortId";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { useToast } from "@/components/ui/Toast";
import {
  type Delivery,
  type DeliveryFilters,
  type DeliveryPage,
  deliveriesPath,
} from "@/lib/deliveries";

// The deliveries table. The first page comes from the server; "Load more" fetches the next one in
// the browser (through the dashboard's /api, with the session cookie) and adds it below.
export function DeliveryList({
  first,
  filters,
}: {
  first: DeliveryPage;
  filters: DeliveryFilters;
}) {
  const toast = useToast();
  const [rows, setRows] = useState(first.deliveries);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(deliveriesPath(filters, cursor));
      if (response.status === 401) {
        window.location.assign("/sign-in?error=expired");
        return;
      }
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const next = (await response.json()) as DeliveryPage;
      setRows((current) => [...current, ...next.deliveries]);
      setCursor(next.next_cursor);
    } catch {
      toast("Couldn't load more deliveries. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Table label="Deliveries">
        <thead>
          <tr>
            <Th>Created</Th>
            <Th>Event</Th>
            <Th>Endpoint</Th>
            <Th>State</Th>
            <Th align="right">Attempts</Th>
            <Th>Last status or error</Th>
            <Th>Next attempt</Th>
            <Th align="right">
              <span className="sr-only">Open</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((delivery) => (
            <Row key={delivery.id} delivery={delivery} />
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

function Row({ delivery }: { delivery: Delivery }) {
  return (
    <tr>
      <Td>
        <LocalTime iso={delivery.created_at} />
      </Td>
      <Td>
        <span className="flex items-center gap-2">
          <Tag>{delivery.event_type ?? "unknown"}</Tag>
          <ShortId id={delivery.event_id} label="event id" />
        </span>
      </Td>
      <Td>
        <Link
          href={`/endpoints/${delivery.endpoint_id}`}
          title={delivery.endpoint_url ?? undefined}
          className="font-medium hover:underline"
        >
          {delivery.endpoint_description || delivery.endpoint_url || "Deleted endpoint"}
        </Link>
      </Td>
      <Td>
        <DeliveryState delivery={delivery} />
      </Td>
      <Td align="right" className="tabular-nums">
        {delivery.attempt_count}
        {delivery.throttled_count > 0 && (
          <span className="text-fg-3"> · {delivery.throttled_count} throttled</span>
        )}
      </Td>
      <Td>
        <LastResult delivery={delivery} />
      </Td>
      <Td>
        <NextAttempt delivery={delivery} />
      </Td>
      <Td align="right">
        <Button size="sm" asChild>
          <Link href={`/deliveries/${delivery.id}`}>Open</Link>
        </Button>
      </Td>
    </tr>
  );
}

// The last attempt's HTTP status, or why there was none ("timeout"), or a dash before any attempt.
function LastResult({ delivery }: { delivery: Delivery }) {
  const result = delivery.last_status ?? delivery.last_error_kind;
  return result === null ? (
    <span className="text-fg-3">—</span>
  ) : (
    <span className="font-mono text-[12.5px]">{result}</span>
  );
}
