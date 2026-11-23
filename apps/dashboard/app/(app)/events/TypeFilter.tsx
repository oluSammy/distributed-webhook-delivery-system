"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Show only one type of event, by its exact name (order.paid). The address keeps it (?type=), so
// it can be bookmarked or shared. A list of your registered types comes with the Settings pages.
export function TypeFilter({ value }: { value: string | null }) {
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const type = String(new FormData(event.currentTarget).get("type")).trim();
    router.push(type ? `/events?type=${encodeURIComponent(type)}` : "/events");
  }

  return (
    <search>
      <form onSubmit={submit} className="flex max-w-md items-center gap-2">
        <Input
          name="type"
          aria-label="Event type"
          defaultValue={value ?? ""}
          placeholder="Only this type, like order.paid"
          className="font-mono"
        />
        <Button type="submit" iconOnly aria-label="Show this type">
          <Search aria-hidden />
        </Button>
        {value && (
          <Button
            iconOnly
            variant="ghost"
            aria-label="Show every type"
            onClick={() => router.push("/events")}
          >
            <X aria-hidden />
          </Button>
        )}
      </form>
    </search>
  );
}
