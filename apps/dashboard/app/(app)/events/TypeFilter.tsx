"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";

// Show only one type of event, chosen from the registered ones. The address keeps it (?type=), so
// it can be bookmarked or shared. A type that's since been removed stays in the list while chosen,
// since its past events are still there.
export function TypeFilter({ value, types }: { value: string | null; types: string[] }) {
  const router = useRouter();
  const options = value && !types.includes(value) ? [value, ...types] : types;
  return (
    <Select
      aria-label="Event type"
      value={value ?? ""}
      onChange={(event) =>
        router.push(
          event.target.value ? `/events?type=${encodeURIComponent(event.target.value)}` : "/events",
        )
      }
      className="max-w-xs font-mono"
    >
      <option value="">Every type</option>
      {options.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </Select>
  );
}
