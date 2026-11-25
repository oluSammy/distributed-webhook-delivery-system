import classNames from "classnames";
import type { ReactNode } from "react";

export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus to scroll by keyboard
      tabIndex={0}
      className="relative overflow-x-auto rounded-inset border border-line bg-card-2"
    >
      <table className="w-full border-collapse text-[13.5px] [&_tbody_tr:hover]:bg-hover [&_tbody_tr:last-child>td]:border-b-0">
        {children}
      </table>
    </section>
  );
}

const alignments = { left: "text-left", right: "text-right" };

export function Th({
  align = "left",
  children,
}: {
  align?: keyof typeof alignments;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-line px-3.5 py-[11px] text-xs font-medium text-fg-3 ${alignments[align]}`}
    >
      {children}
    </th>
  );
}

export function Td({
  align = "left",
  className,
  children,
}: {
  align?: keyof typeof alignments;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      className={classNames(
        "whitespace-nowrap border-b border-line px-3.5 py-3 align-middle",
        alignments[align],
        className,
      )}
    >
      {children}
    </td>
  );
}
