"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { apiPost, apiRequest, RequestError } from "@/lib/browser-api";
import type { EventType } from "@/lib/event-types";

// The event types POST /api/events accepts, how many endpoints each reaches, and adding or
// removing one. Anyone in the workspace can, as code can with an API key.
export function EventTypes({ types }: { types: EventType[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    if (!name) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await apiPost("/api/event-types", { name });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof RequestError
          ? (err.details[0]?.message ?? err.message)
          : "Couldn't add it. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {types.length === 0 ? (
        <p className="text-fg-2">
          None yet. Add the types your code will send: events of any other type are refused.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-inset border border-line">
          {types.map((type) => (
            <li key={type.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="font-mono text-[13px]">{type.name}</span>
              <span className="mr-auto text-[13px] text-fg-3">
                {type.endpoints === 0 ? (
                  <span className="flex items-center gap-1.5 text-fail">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    Reaches no endpoint
                  </span>
                ) : (
                  `Reaches ${type.endpoints} ${type.endpoints === 1 ? "endpoint" : "endpoints"}`
                )}
              </span>
              <RemoveType name={type.name} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex max-w-md flex-col gap-1.5">
        <div className="flex gap-2">
          <Input
            name="name"
            aria-label="New event type"
            aria-invalid={error ? true : undefined}
            aria-describedby="event-type-help"
            placeholder="order.paid"
            maxLength={255}
            autoComplete="off"
            className="font-mono"
          />
          <Button type="submit" disabled={busy}>
            <Plus aria-hidden />
            Add
          </Button>
        </div>
        <p
          id="event-type-help"
          className={error ? "text-[12.5px] text-dead" : "text-[12.5px] text-fg-3"}
        >
          {error ?? "Lowercase words separated by dots, like order.paid."}
        </p>
      </form>
    </div>
  );
}

// Remove, after saying what it does: new events of it are refused; past ones are kept.
function RemoveType({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/event-types/${name}`);
      toast(`${name} removed`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof RequestError ? err.message : "Couldn't remove it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Remove ${name}`}>
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Remove ${name}?`}
        description="New events of this type will be refused (422). Events already received, and their deliveries, are kept. Endpoint subscriptions stay, so adding it back makes them work again."
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? "Removing…" : "Remove type"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
