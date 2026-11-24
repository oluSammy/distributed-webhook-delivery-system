import { unstable_rethrow } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { UsageBanner } from "@/components/UsageBanner";
import { getMe } from "@/lib/api";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-3 p-3 md:flex-row md:items-start md:gap-5 md:p-5">
      {/* The sidebar's frame shows at once; the person and tenant follow when the API answers. */}
      <Suspense fallback={<Sidebar me={null} />}>
        <SignedInSidebar />
      </Suspense>
      <main className="flex min-w-0 flex-1 flex-col gap-5">
        {/* Only from 80% of today's event limit. It never holds up the page: until the API
            answers, nothing is shown in its place. */}
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
