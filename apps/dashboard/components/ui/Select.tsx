import classNames from "classnames";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

// A dropdown: the browser's own, so keyboards, screen readers and phones handle it natively,
// styled like Input.
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className={classNames("relative", className)}>
      <select
        className={classNames(
          "h-10 w-full cursor-pointer appearance-none rounded-xl border border-line-2 bg-card-2",
          "pr-9 pl-3.5 text-[13.5px] text-fg aria-invalid:border-dead",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-3"
      />
    </div>
  );
}
