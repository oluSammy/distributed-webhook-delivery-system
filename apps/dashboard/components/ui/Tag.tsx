import type { ReactNode } from "react";

// A short code-like value in a grey box: an event type (order.paid) or a subscription (order.*).
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-[7px] bg-card-3 px-2 font-mono text-xs text-fg-2">
      {children}
    </span>
  );
}
