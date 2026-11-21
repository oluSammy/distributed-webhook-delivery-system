import classNames from "classnames";
import type { ComponentProps } from "react";

// A filter button, like "Degraded 1". pressed marks the filter that's on.
export function Chip({
  pressed = false,
  count,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { pressed?: boolean; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={classNames(
        "inline-flex h-[34px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px]",
        pressed
          ? "border-accent-line bg-accent-soft text-fg"
          : "border-line bg-transparent text-fg-2 hover:bg-hover",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="text-[11.5px] text-fg-3">{count.toLocaleString("en")}</span>
      )}
    </button>
  );
}
