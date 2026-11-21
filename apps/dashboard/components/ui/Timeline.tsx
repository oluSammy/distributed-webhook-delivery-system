import classNames from "classnames";
import type { ReactNode } from "react";

// A vertical list of steps joined by a line, like a delivery's attempts:
//   <Timeline>
//     <TimelineItem marker="1" tone="fail">…</TimelineItem>
//     <TimelineGap>retried 23 s later</TimelineGap>
//     <TimelineItem marker="2" tone="ok">…</TimelineItem>
//   </Timeline>
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col">{children}</ol>;
}

const tones = {
  ok: "border-ok/45 bg-ok-soft text-ok",
  fail: "border-fail/45 bg-fail-soft text-fail",
  dead: "border-dead/45 bg-dead-soft text-dead",
  pend: "border-pend/45 bg-pend-soft text-pend",
};

const line =
  "before:absolute before:left-[15px] before:w-px before:bg-line-2 before:content-[''] last:before:hidden";

export function TimelineItem({
  marker,
  tone,
  upcoming = false,
  faded = false,
  children,
}: {
  marker: string;
  tone: keyof typeof tones;
  upcoming?: boolean;
  faded?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={classNames(
        "relative pb-1 pl-10 before:top-[34px] before:-bottom-1.5",
        line,
        faded && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={classNames(
          "absolute top-1.5 left-0 flex size-[31px] items-center justify-center rounded-full border text-xs font-semibold",
          upcoming ? "border-dashed border-accent-line bg-card text-accent" : tones[tone],
        )}
      >
        {marker}
      </span>
      <div
        className={classNames(
          "flex flex-col gap-2.5 rounded-inset border border-line bg-card-2 p-3.5",
          upcoming && "border-dashed",
        )}
      >
        {children}
      </div>
    </li>
  );
}

// The time between two steps, written on the line: "retried 23 s later".
export function TimelineGap({ children }: { children: ReactNode }) {
  return (
    <li
      className={classNames(
        "relative py-2.5 pl-10 text-[12.5px] text-fg-3 before:top-0 before:bottom-0",
        line,
      )}
    >
      {children}
    </li>
  );
}
