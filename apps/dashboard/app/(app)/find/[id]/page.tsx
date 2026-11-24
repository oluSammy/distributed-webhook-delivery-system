import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";

export const metadata: Metadata = { title: "Find · Webhooks" };

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where the search box sends an id: asks the API what it is, then goes to its page. Not one of
// this workspace's: the not-found page (apiGet calls notFound() on the API's 404).
const PAGES = { endpoint: "/endpoints", delivery: "/deliveries", event: "/events" } as const;

export default function FindPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <Find params={params} />
    </Suspense>
  );
}

// redirect() never returns, so the end is never reached: the type says what JSX needs.
async function Find({ params }: { params: Params }): Promise<ReactNode> {
  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }
  const found = await apiGet<{ kind: keyof typeof PAGES; id: string }>(`/api/lookup/${id}`);
  redirect(`${PAGES[found.kind]}/${found.id}`);
}
