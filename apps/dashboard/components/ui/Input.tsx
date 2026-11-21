import classNames from "classnames";
import type { ComponentProps } from "react";

// A text box. It turns red when aria-invalid is set
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={classNames(
        "h-10 w-full rounded-xl border border-line-2 bg-card-2 px-3.5 text-[13.5px] text-fg",
        "placeholder:text-fg-3 aria-invalid:border-dead",
        className,
      )}
      {...props}
    />
  );
}
