"use client";

import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";
import { type DeliveryFilters, deliveriesPage, type StateFilter as Filter } from "@/lib/deliveries";

const OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "succeeded", label: "Succeeded" },
  { value: "dead", label: "Dead" },
  { value: "cancelled", label: "Cancelled" },
];

// The state filter. Choosing one changes the address (?state=dead), keeping an endpoint or event
// filter, so the page renders again on the server with it, and can be bookmarked or shared.
export function StateFilter({ filters }: { filters: DeliveryFilters }) {
  const router = useRouter();
  return (
    <Segmented
      label="Filter by state"
      options={OPTIONS}
      value={filters.state}
      onChange={(state) => router.push(deliveriesPage({ ...filters, state }))}
    />
  );
}
