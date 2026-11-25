import type { ReactNode } from "react";
import { FindById } from "./FindById";
import { ThemeSwitch } from "./ThemeSwitch";

export function TopBar({
  title,
  subtitle,
  breadcrumb,
  search,
  children,
}: {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  search?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line pt-1 pb-4">
      <div className="mr-auto min-w-0">
        {breadcrumb}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-fg-3">{subtitle}</p>}
      </div>
      {children}
      {search ?? <FindById />}
      <ThemeSwitch />
    </header>
  );
}
