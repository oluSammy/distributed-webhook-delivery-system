import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const tones = {
  pause: "border-pause/35 bg-pause-soft [&>svg]:text-pause",
  dis: "border-dis/35 bg-dis-soft [&>svg]:text-dis",
  fail: "border-fail/35 bg-fail-soft [&>svg]:text-fail",
  dead: "border-dead/35 bg-dead-soft [&>svg]:text-dead",
  info: "border-accent-line bg-accent-soft [&>svg]:text-accent",
};

export function Banner({
  tone,
  icon: Icon,
  action,
  children,
}: {
  tone: keyof typeof tones;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border px-4 py-3 text-[13.5px] ${tones[tone]}`}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
