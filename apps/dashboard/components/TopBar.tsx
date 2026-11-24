import type { ReactNode } from "react";
import { ThemeSwitch } from "./ThemeSwitch";
import { FindById } from "./FindById";

export function TopBar({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line pt-1 pb-4">
      <div className="mr-auto min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-fg-3">{subtitle}</p>}
      </div>
      {children}
      <FindById />
      <ThemeSwitch />
    </header>
  );
}
