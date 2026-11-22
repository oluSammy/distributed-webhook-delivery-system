import { type ReactNode, Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { getMe } from "@/lib/api";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-3 p-3 md:flex-row md:items-start md:gap-5 md:p-5">
      {/* The sidebar's frame shows at once; the person and tenant follow when the API answers. */}
      <Suspense fallback={<Sidebar me={null} />}>
        <SignedInSidebar />
      </Suspense>
      <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
    </div>
  );
}

async function SignedInSidebar() {
  return <Sidebar me={await getMe()} />;
}
