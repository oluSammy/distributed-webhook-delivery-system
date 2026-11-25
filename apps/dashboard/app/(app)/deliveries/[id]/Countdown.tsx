"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

// How long until a time, counting down each second: "in 2 min 14 s", then "due now" once it's
// passed. The server can't know the reader's clock, so it sends nothing here and the browser fills
// it in as soon as the page starts. Not announced to screen readers each second: the time beside
// it says the same once.
export function Countdown({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  if (now === null) {
    return null;
  }
  const seconds = Math.ceil((Date.parse(iso) - now) / 1000);
  if (seconds <= 0) {
    return <span>due now</span>;
  }
  return (
    <span className="tabular-nums">
      in {seconds < 60 ? `${seconds} s` : formatDuration(seconds * 1000)}
    </span>
  );
}
