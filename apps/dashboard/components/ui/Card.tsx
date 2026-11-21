import classNames from "classnames";
import type { ComponentProps } from "react";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={classNames(
        "min-w-0 rounded-card border border-line bg-card p-5 shadow-card",
        className,
      )}
      {...props}
    />
  );
}
