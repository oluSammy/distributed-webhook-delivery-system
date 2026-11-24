import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// A page that couldn't show what was asked for: not found, or couldn't load. An icon, a heading
// that says what happened, a line on why and what to do, and buttons to carry on.
export function Problem({
  icon: Icon,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-3 py-16 text-center">
      <Icon aria-hidden className="size-8 text-fg-3" />
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      <div className="text-fg-2">{children}</div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
    </section>
  );
}
