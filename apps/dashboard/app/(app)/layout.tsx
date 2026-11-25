import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { PauseBanner } from "@/components/PauseBanner";
import { COLLAPSED_COOKIE, Sidebar, type SidebarCounts } from "@/components/Sidebar";
import { UsageBanner } from "@/components/UsageBanner";
import { apiGet, getMe } from "@/lib/api";
import type { DlqCounts } from "@/lib/dlq";
import type { Endpoint } from "@/lib/endpoints";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-3 p-3 md:flex-row md:items-start md:gap-5 md:p-5">
      <a
        href="#content"
        className="sr-only rounded-full bg-accent font-medium text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Suspense fallback={<Sidebar me={null} />}>
        <SignedInSidebar />
      </Suspense>
      <main id="content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-5 outline-none">
        {/* Only from 80% of today's event limit. It never holds up the page: until the API
            answers, nothing is shown in its place. */}
        <Suspense fallback={null}>
          <PauseBanner />
        </Suspense>
        <Suspense fallback={null}>
          <UsageBanner />
        </Suspense>
        {children}
      </main>
    </div>
  );
}

async function SignedInSidebar() {
  const collapsed = (await cookies()).get(COLLAPSED_COOKIE)?.value === "collapsed";
  try {
    const [me, counts] = await Promise.all([getMe(), sidebarCounts()]);
    return <Sidebar me={me} counts={counts} collapsed={collapsed} />;
  } catch (error) {
    unstable_rethrow(error);
    return <Sidebar me={null} collapsed={collapsed} />;
  }
}

async function sidebarCounts(): Promise<SidebarCounts> {
  try {
    const [{ endpoints }, dead] = await Promise.all([
      apiGet<{ endpoints: Endpoint[] }>("/api/endpoints"),
      apiGet<DlqCounts>("/api/dlq/counts"),
    ]);
    return { endpoints: endpoints.length, dead: dead.total };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
