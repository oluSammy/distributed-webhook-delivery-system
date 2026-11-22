"use client";

import { useEffect, useState } from "react";

// A time in the reader's own time zone, with the exact UTC time on hover: "14 Nov, 13:58:37".
// The server doesn't know the reader's time zone, so it sends the time in UTC; the browser swaps
// in its own as soon as the page starts. In most places the two are the same.
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => format(iso, "UTC"));
  useEffect(() => setText(format(iso)), [iso]);
  return (
    <time dateTime={iso} title={iso} className="tabular-nums">
      {text}
    </time>
  );
}

function format(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(new Date(iso));
}
