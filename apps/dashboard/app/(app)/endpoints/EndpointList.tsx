"use client";

import Link from "next/link";
import { useState } from "react";
import { EndpointState } from "@/components/EndpointState";
import { LocalTime } from "@/components/LocalTime";
import { Chip } from "@/components/ui/Chip";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { type Endpoint, endpointName, successRate } from "@/lib/endpoints";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "disabled", label: "Disabled" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

// How many subscriptions to show in a row before "+3 more".
const SHOWN_SUBSCRIPTIONS = 2;

// The tenant's endpoints, with chips to show one state. A tenant has few endpoints, so all of
// them come at once and the chips filter here, in the browser.
export function EndpointList({ endpoints }: { endpoints: Endpoint[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? endpoints : endpoints.filter((e) => e.state === filter);
  const count = (value: Filter) =>
    value === "all" ? endpoints.length : endpoints.filter((e) => e.state === value).length;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Show endpoints that are</legend>
        {FILTERS.map(({ value, label }) => (
          <Chip
            key={value}
            pressed={filter === value}
            count={count(value)}
            onClick={() => setFilter(value)}
          >
            {label}
          </Chip>
        ))}
      </fieldset>
      <Table label="Endpoints">
        <thead>
          <tr>
            <Th>Endpoint</Th>
            <Th>State</Th>
            <Th>Subscriptions</Th>
            <Th align="right">Success 24 h</Th>
            <Th>Last delivery</Th>
            <Th align="right">Limits</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((endpoint) => (
            <tr key={endpoint.id}>
              <Td>
                <Link href={`/endpoints/${endpoint.id}`} className="font-medium hover:underline">
                  {endpointName(endpoint)}
                </Link>
                {endpoint.description && (
                  <span
                    title={endpoint.url}
                    className="block max-w-[280px] truncate font-mono text-xs text-fg-3"
                  >
                    {endpoint.url}
                  </span>
                )}
              </Td>
              <Td>
                <EndpointState state={endpoint.state} />
              </Td>
              <Td>
                <span className="flex items-center gap-1.5">
                  {endpoint.subscriptions.slice(0, SHOWN_SUBSCRIPTIONS).map((pattern) => (
                    <Tag key={pattern}>{pattern}</Tag>
                  ))}
                  {endpoint.subscriptions.length > SHOWN_SUBSCRIPTIONS && (
                    <span
                      className="text-xs text-fg-3"
                      title={endpoint.subscriptions.slice(SHOWN_SUBSCRIPTIONS).join(", ")}
                    >
                      +{endpoint.subscriptions.length - SHOWN_SUBSCRIPTIONS} more
                    </span>
                  )}
                </span>
              </Td>
              <Td align="right" className="tabular-nums">
                <Success endpoint={endpoint} />
              </Td>
              <Td>
                {endpoint.last_delivery_at ? (
                  <LocalTime iso={endpoint.last_delivery_at} />
                ) : (
                  <span className="text-fg-3">Never</span>
                )}
              </Td>
              <Td align="right" className="tabular-nums text-fg-2">
                {endpoint.rate_limit_per_s.toLocaleString("en")}/s · {endpoint.concurrency_limit} at
                once
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {shown.length === 0 && (
        <p className="text-center text-fg-3">No endpoints are {filter} right now.</p>
      )}
      <p className="text-[12.5px] text-fg-3">
        Success is the share of the last 24 hours' finished deliveries that arrived. Deliveries
        still being retried aren't counted until they finish.
      </p>
    </div>
  );
}

// "97.3%", coloured by how it's going, with how many are still being retried; "—" when nothing
// finished in the last 24 hours.
function Success({ endpoint }: { endpoint: Endpoint }) {
  const rate = successRate(endpoint);
  const { succeeded, dead, pending } = endpoint.deliveries_24h;
  if (rate === null) {
    return <span className="text-fg-3">{pending > 0 ? `${pending} pending` : "—"}</span>;
  }
  const share = succeeded / (succeeded + dead);
  const color = share >= 0.99 ? "text-ok" : share >= 0.9 ? "text-fail" : "text-dead";
  return (
    <span title={`${succeeded} arrived, ${dead} died, ${pending} still being retried`}>
      <span className={`font-medium ${color}`}>{rate}</span>
      {pending > 0 && <span className="text-fg-3"> · {pending} pending</span>}
    </span>
  );
}
