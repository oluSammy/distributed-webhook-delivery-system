"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { apiPost, RequestError } from "@/lib/browser-api";
import type { Endpoint } from "@/lib/endpoints";

type Range = "hour" | "day" | "custom";

const HOUR = 3_600_000;

// Replay: sends this endpoint every stored event from a time range that its subscriptions match,
// as new deliveries (a backfill after an outage). The API does it a page at a time; this keeps
// calling with the cursor until it's done, and shows how many so far.
export function ReplayDialog({ endpoint }: { endpoint: Endpoint }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("hour");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  // The chosen range as the API takes it. A custom range comes from datetime inputs, which are in
  // the reader's own time zone; new Date() reads them that way.
  function period(): { since: string; until: string } | null {
    const until = Date.now();
    if (range === "hour") {
      return { since: new Date(until - HOUR).toISOString(), until: new Date(until).toISOString() };
    }
    if (range === "day") {
      return {
        since: new Date(until - 24 * HOUR).toISOString(),
        until: new Date(until).toISOString(),
      };
    }
    if (!from || !to) {
      return null;
    }
    return { since: new Date(from).toISOString(), until: new Date(to).toISOString() };
  }

  async function replay() {
    const chosen = period();
    if (!chosen) {
      setError("Choose when to start and when to stop.");
      return;
    }
    running.current = true;
    setError(null);
    setCreated(0);
    let total = 0;
    let cursor: string | null = null;
    try {
      do {
        const page: { deliveries_created: number; next_cursor: string | null } = await apiPost(
          `/api/endpoints/${endpoint.id}/replay`,
          { ...chosen, limit: 500, ...(cursor ? { cursor } : {}) },
        );
        total += page.deliveries_created;
        setCreated(total);
        cursor = page.next_cursor;
      } while (cursor && running.current);
      toast(
        `Replay queued ${total.toLocaleString("en")} ${total === 1 ? "delivery" : "deliveries"}`,
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "The replay stopped. Try again.");
    } finally {
      running.current = false;
    }
  }

  function close(next: boolean) {
    // Closing stops a replay after the page in progress; what's queued stays queued.
    running.current = false;
    setOpen(next);
    if (!next) {
      setCreated(null);
      setError(null);
    }
  }

  const busy = created !== null && !error;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button disabled={endpoint.state === "paused"}>
          <History aria-hidden />
          Replay
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Replay events to this endpoint"
        description="Sends every stored event from the time range that this endpoint's subscriptions match, as new deliveries. Each carries its event's id as webhook-id, so a receiver that
skips duplicates skips ones it already has."
      >
        <Segmented
          label="Time range"
          value={range}
          onChange={setRange}
          options={[
            { value: "hour", label: "Last hour" },
            { value: "day", label: "Last 24 hours" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {range === "custom" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              {(control) => (
                <Input
                  {...control}
                  type="datetime-local"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              )}
            </Field>
            <Field label="To">
              {(control) => (
                <Input
                  {...control}
                  type="datetime-local"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <div aria-live="polite">
          {created !== null && (
            <p className="tabular-nums">
              {busy ? "Creating deliveries… " : ""}
              {created.toLocaleString("en")} so far
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-dead">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>{busy ? "Stop" : "Cancel"}</Button>
          </DialogClose>
          <Button variant="primary" onClick={replay} disabled={busy}>
            Replay
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
