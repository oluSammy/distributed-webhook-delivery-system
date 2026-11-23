"use client";

import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";
import type { Range } from "@/lib/stats";

const OPTIONS: { value: Range; label: string }[] = [
  { value: "1h", label: "1 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
];

// The Overview's time range. Like the Deliveries filter, it changes the address (?range=7d), so
// the page is rendered again on the server for that range, and Back works.
export function RangeSwitch({ value }: { value: Range }) {
  const router = useRouter();
  return (
    <Segmented
      label="Time range"
      options={OPTIONS}
      value={value}
      onChange={(range) => router.push(range === "24h" ? "/" : `/?range=${range}`)}
    />
  );
}
