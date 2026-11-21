"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";

// Segmented needs state (which option is chosen), so its demo is a small client component.
export function RangeDemo() {
  const [range, setRange] = useState<"1h" | "24h" | "7d">("24h");
  return (
    <Segmented
      label="Time range"
      value={range}
      onChange={setRange}
      options={[
        { value: "1h", label: "1 h" },
        { value: "24h", label: "24 h" },
        { value: "7d", label: "7 d" },
      ]}
    />
  );
}
