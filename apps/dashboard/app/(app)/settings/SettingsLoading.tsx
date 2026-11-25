import { Skeleton } from "@/components/ui/Skeleton";

// While a Settings section loads: a card's worth of grey.
export function SettingsLoading() {
  return (
    <section aria-busy="true" aria-label="Loading settings" className="flex flex-col gap-5">
      <Skeleton className="h-48 w-full rounded-card" />
    </section>
  );
}
