import { unstable_rethrow } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { PauseBanner } from "@/components/PauseBanner";
import { Sidebar } from "@/components/Sidebar";
import { UsageBanner } from "@/components/UsageBanner";
import { getMe } from "@/lib/api";

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

// If /api/me fails, the sidebar keeps its empty frame, so the page's own error shows inside the
// layout instead of the whole screen failing. A redirect to sign in (a 401) still goes through.
async function SignedInSidebar() {
  try {
    return <Sidebar me={await getMe()} />;
  } catch (error) {
    unstable_rethrow(error);
    return <Sidebar me={null} />;
  }
}
