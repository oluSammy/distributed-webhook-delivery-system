import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-3 p-3 md:flex-row md:items-start md:gap-5 md:p-5">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
    </div>
  );
}
