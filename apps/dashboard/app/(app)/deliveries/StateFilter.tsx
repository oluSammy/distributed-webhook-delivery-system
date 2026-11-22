"use client";

import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";
import type { StateFilter as Filter } from "@/lib/deliveries";

const OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "succeeded", label: "Succeeded" },
  { value: "dead", label: "Dead" },
  { value: "cancelled", label: "Cancelled" },
];

// The state filter. Choosing one changes the address (?state=dead), so the page renders again on
// the server with that filter, and the address can be bookmarked or shared.
export function StateFilter({ value }: { value: Filter }) {
  const router = useRouter();
  return (
    <Segmented
      label="Filter by state"
      options={OPTIONS}
      value={value}
      onChange={(state) =>
        router.push(state === "all" ? "/deliveries" : `/deliveries?state=${state}`)
      }
    />
  );
}
