import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";
import { type DeadPage, type DlqCounts, dlqPath } from "@/lib/dlq";
import { DeadLetterQueue } from "./DeadLetterQueue";

export const metadata: Metadata = { title: "Dead-letter queue · Webhooks" };

type SearchParams = Promise<{ reason?: string }>;

export default function DeadLetterPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TopBar
        title="Dead-letter queue"
        subtitle="Deliveries we gave up on · redeliver or discard them"
      />
      <Suspense fallback={<LoadingQueue />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const { reason = null } = await searchParams;
  // The first page and the counts, asked for at the same time.
  const [first, counts] = await Promise.all([
    apiGet<DeadPage>(dlqPath(reason)),
    apiGet<DlqCounts>("/api/dlq/counts"),
  ]);
  if (counts.total === 0) {
    return <EmptyQueue />;
  }
  return (
    // key: after a bulk action the page renders again with new data; a new key starts the list
    // (and its selection) afresh instead of keeping the old rows.
    <DeadLetterQueue
      key={`${reason}:${counts.total}:${first.deliveries[0]?.id}`}
      first={first}
      counts={counts}
      reason={reason}
    />
  );
}

function EmptyQueue() {
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
      <Inbox aria-hidden className="size-6 text-fg-3" />
      <h2 className="text-[15px] font-semibold">Nothing in the dead-letter queue</h2>
      <p className="max-w-md text-fg-2">
        Every delivery either succeeded or is still being retried. Deliveries land here only when we
        give up on them.
      </p>
    </Card>
  );
}

function LoadingQueue() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading the dead-letter queue"
      className="flex flex-col gap-4"
    >
      <div className="flex gap-2">
        <Skeleton className="h-8.5 w-20 rounded-full" />
        <Skeleton className="h-8.5 w-36 rounded-full" />
        <Skeleton className="h-8.5 w-28 rounded-full" />
      </div>
      <Skeleton className="h-96 w-full rounded-inset" />
    </section>
  );
}
