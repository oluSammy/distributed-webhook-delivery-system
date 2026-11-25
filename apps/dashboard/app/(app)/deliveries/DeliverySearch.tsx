"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Input } from "@/components/ui/Input";
import { deliveriesPage, NO_FILTERS } from "@/lib/deliveries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Found = { kind: "endpoint" | "delivery" | "event"; id: string };

export function DeliverySearch() {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = String(new FormData(form).get("id")).trim().toLowerCase();
    if (!UUID.test(id)) {
      setProblem("Paste a full id, like 01a2039b-…-61d4.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/lookup/${id}`);
      if (response.status === 401) {
        window.location.assign("/sign-in?error=expired");
        return;
      }
      if (response.status === 404) {
        setProblem("No delivery, event or endpoint in this workspace has that id.");
        return;
      }
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const found = (await response.json()) as Found;
      form.reset();
      if (found.kind === "delivery") {
        router.push(`/deliveries/${found.id}`);
      } else if (found.kind === "event") {
        router.push(deliveriesPage({ ...NO_FILTERS, eventId: found.id }));
      } else {
        router.push(deliveriesPage({ ...NO_FILTERS, endpointId: found.id }));
      }
    } catch {
      setProblem("Couldn't search just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <search>
      <form onSubmit={submit} className="relative w-72 max-w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
        />
        <Input
          name="id"
          aria-label="Search deliveries by delivery, event or endpoint id"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "delivery-search-hint" : undefined}
          onChange={() => setProblem(null)}
          placeholder="Search by event id or delivery id"
          readOnly={busy}
          autoComplete="off"
          spellCheck={false}
          className="pl-9 font-mono text-[12.5px]"
        />
        {problem && (
          <p
            id="delivery-search-hint"
            role="alert"
            className="absolute top-full left-0 z-10 mt-1 rounded-lg bg-card px-2.5 py-1.5 text-[12.5px] text-dead shadow-card"
          >
            {problem}
          </p>
        )}
      </form>
    </search>
  );
}
