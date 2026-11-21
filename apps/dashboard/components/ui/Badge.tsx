import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// One per state colour in globals.css. neutral is for counts and labels that aren't a state.
const tones = {
  ok: "border-ok/30 bg-ok-soft text-ok",
  fail: "border-fail/30 bg-fail-soft text-fail",
  dead: "border-dead/30 bg-dead-soft text-dead",
  pend: "border-pend/30 bg-pend-soft text-pend",
  pause: "border-pause/30 bg-pause-soft text-pause",
  dis: "border-dis/30 bg-dis-soft text-dis",
  cancel: "border-cancel/30 bg-cancel-soft text-cancel",
  neutral: "border-line-2 bg-card-2 text-fg-2",
};

export type BadgeTone = keyof typeof tones;

// A state shown as a word and an icon in its colour, never colour alone (for colour-blind readers).
export function Badge({
  tone,
  icon: Icon,
  children,
}: {
  tone: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium ${tones[tone]}`}
    >
      {Icon && <Icon aria-hidden className="size-3 [stroke-width:2.25]" />}
      {children}
    </span>
  );
}
