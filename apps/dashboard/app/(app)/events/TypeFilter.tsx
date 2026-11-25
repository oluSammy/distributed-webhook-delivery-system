"use client";

import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Select";

// Up to this many types show as chips; more would be a wall of them, so a dropdown instead.
const MAX_CHIPS = 8;

// Show only one type of event, chosen from the registered ones. The address keeps it (?type=), so
// it can be bookmarked or shared. A type that's since been removed stays in the list while chosen,
// since its past events are still there.
export function TypeFilter({ value, types }: { value: string | null; types: string[] }) {
  const router = useRouter();
  const options = value && !types.includes(value) ? [value, ...types] : types;
  const choose = (type: string | null) =>
    router.push(type ? `/events?type=${encodeURIComponent(type)}` : "/events");

  if (options.length <= MAX_CHIPS) {
    return (
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Event type</legend>
        <Chip pressed={value === null} onClick={() => choose(null)}>
          All types
        </Chip>
        {options.map((type) => (
          <Chip
            key={type}
            pressed={value === type}
            onClick={() => choose(type)}
            className="font-mono text-[12.5px]"
          >
            {type}
          </Chip>
        ))}
      </fieldset>
    );
  }
  return (
    <Select
      aria-label="Event type"
      value={value ?? ""}
      onChange={(event) => choose(event.target.value || null)}
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
