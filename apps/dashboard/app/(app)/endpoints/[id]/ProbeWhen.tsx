"use client";

import { useEffect, useState } from "react";
import { LocalTime } from "@/components/LocalTime";

// When a disabled endpoint's test delivery goes out: "goes out at 14:12", or once that time has
// passed, "was due at 14:12 and goes out as soon as it can" (the Dispatcher sends it on its next
// run). The browser decides, by its own clock, and checks again every 15 seconds.
export function ProbeWhen({ iso }: { iso: string }) {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    const check = () => setOverdue(Date.parse(iso) <= Date.now());
    check();
    const timer = setInterval(check, 15_000);
    return () => clearInterval(timer);
  }, [iso]);
  return overdue ? (
    <>
      was due at <LocalTime iso={iso} /> and goes out as soon as it can
    </>
  ) : (
    <>
      goes out at <LocalTime iso={iso} />
    </>
  );
}
