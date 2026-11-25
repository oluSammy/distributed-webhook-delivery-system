"use client";

import { OctagonX, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/Dialog";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { useToast } from "@/components/ui/Toast";
import { apiPost } from "@/lib/browser-api";
import { type DeadPage, type DlqCounts, dlqPath, reasonLabel } from "@/lib/dlq";

// The API's limits for one bulk call: 100 chosen ids, or 1,000 matching ones.
const IDS_PER_CALL = 100;
const MATCHING_PER_CALL = 1000;

type Action = "redeliver" | "discard";

// "1 delivery", "37 deliveries".
function deliveryCount(count: number): string {
  return `${count.toLocaleString("en")} ${count === 1 ? "delivery" : "deliveries"}`;
}

// The dead-letter queue: reason chips, the table with checkboxes, and bulk Redeliver or Discard
// for the rows chosen or for everything matching the chosen reason.
export function DeadLetterQueue({
  first,
  counts,
  reason,
}: {
  first: DeadPage;
  counts: DlqCounts;
  reason: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(first.deliveries);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  // The row being redelivered on its own, so only its button waits.
  const [redelivering, setRedelivering] = useState<string | null>(null);

  // How many match the chosen reason (or all of them), from the counts.
  const matching = reason
    ? (counts.reasons.find((row) => row.reason === reason)?.count ?? 0)
    : counts.total;
  const chosen = allMatching ? matching : selected.size;
  const everyRowChosen = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggle(id: string) {
    setAllMatching(false);
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllRows() {
    setAllMatching(false);
    setSelected(everyRowChosen ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function clear() {
    setAllMatching(false);
    setSelected(new Set());
  }

  async function loadMore() {
    if (!cursor) {
      return;
    }
    const response = await fetch(dlqPath(reason, cursor));
    if (!response.ok) {
      toast("Couldn't load more. Try again.");
      return;
    }
    const next = (await response.json()) as DeadPage;
    setRows((current) => [...current, ...next.deliveries]);
    setCursor(next.next_cursor);
  }

  // Sends the action for the chosen rows, 100 ids per call, or for everything matching, 1,000
  // per call until a call finds fewer (then none are left). Returns how many it did.
  async function run(action: Action): Promise<number> {
    const filters = reason ? { reason } : {};
    let done = 0;
    if (allMatching) {
      for (;;) {
        const { deliveries } = await apiPost<{ deliveries: unknown[] }>(`/api/dlq/${action}`, {
          ...filters,
          limit: MATCHING_PER_CALL,
        });
        done += deliveries.length;
        if (deliveries.length < MATCHING_PER_CALL) {
          return done;
        }
      }
    }
    const ids = [...selected];
    for (let start = 0; start < ids.length; start += IDS_PER_CALL) {
      const { deliveries } = await apiPost<{ deliveries: unknown[] }>(`/api/dlq/${action}`, {
        ids: ids.slice(start, start + IDS_PER_CALL),
        limit: IDS_PER_CALL,
      });
      done += deliveries.length;
    }
    return done;
  }

  async function redeliverOne(id: string) {
    setRedelivering(id);
    try {
      await apiPost(`/api/dlq/${id}/redeliver`);
      toast("Redelivered 1 delivery");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work. Try again.");
    } finally {
      setRedelivering(null);
    }
  }

  async function confirm() {
    if (!confirming) {
      return;
    }
    setBusy(true);
    try {
      const done = await run(confirming);
      toast(`${confirming === "redeliver" ? "Redelivered" : "Discarded"} ${deliveryCount(done)}`);
      setConfirming(null);
      clear();
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filter by reason</legend>
        <Chip pressed={reason === null} count={counts.total} onClick={() => router.push("/dlq")}>
          All
        </Chip>
        {counts.reasons.map((row) => (
          <Chip
            key={row.reason}
            pressed={reason === row.reason}
            count={row.count}
            onClick={() => router.push(`/dlq?reason=${encodeURIComponent(row.reason)}`)}
          >
            {reasonLabel(row.reason)}
          </Chip>
        ))}
      </fieldset>

      {chosen > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-inset border border-accent-line bg-accent-soft px-4 py-2.5"
        >
          <strong className="tabular-nums">{chosen.toLocaleString("en")} chosen</strong>
          {everyRowChosen && !allMatching && matching > rows.length && (
            <Button size="sm" variant="ghost" onClick={() => setAllMatching(true)}>
              Choose all {matching.toLocaleString("en")} matching
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setConfirming("discard")}>
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => setConfirming("redeliver")}>
              <RotateCcw aria-hidden />
              Redeliver
            </Button>
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        // Another reason still has dead deliveries (or the page would show the empty queue), but
        // not this one: its last ones were just redelivered or discarded.
        <div className="flex flex-col items-center gap-3 rounded-inset border border-line bg-card-2 py-10 text-center">
          <p className="text-fg-2">Nothing left in the queue for this reason.</p>
          <Button size="sm" onClick={() => router.push("/dlq")}>
            Show all {counts.total.toLocaleString("en")}
          </Button>
        </div>
      ) : (
        <>
          <Table label="Dead deliveries">
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    aria-label="Choose every row shown"
                    checked={everyRowChosen}
                    onChange={toggleAllRows}
                    className="size-[18px] accent-accent"
                  />
                </Th>
                <Th>Died</Th>
                <Th>Event type</Th>
                <Th>Endpoint</Th>
                <Th>Reason</Th>
                <Th align="right">Attempts</Th>
                <Th>Last status or error</Th>
                <Th align="right">
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Choose ${row.event_type} to ${row.endpoint_description || row.endpoint_url}`}
                      checked={allMatching || selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className="size-[18px] accent-accent"
                    />
                  </Td>
                  <Td>
                    <LocalTime iso={row.finished_at} />
                  </Td>
                  <Td>
                    <Tag>{row.event_type}</Tag>
                  </Td>
                  <Td>
                    <span title={row.endpoint_url ?? undefined}>
                      {row.endpoint_description || row.endpoint_url || "Deleted endpoint"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone="dead" icon={OctagonX}>
                      {reasonLabel(row.failure_reason)}
                    </Badge>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {row.attempt_count}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px]">
                      {row.last_status ?? row.last_error_kind ?? "—"}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" asChild>
                        <Link href={`/deliveries/${row.id}`}>Open</Link>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => redeliverOne(row.id)}
                        disabled={redelivering !== null || busy}
                        aria-label={`Redeliver ${row.event_type} to ${row.endpoint_description || row.endpoint_url || "a deleted endpoint"}`}
                      >
                        {redelivering === row.id ? "Redelivering…" : "Redeliver"}
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-3 text-fg-3">
            <span className="tabular-nums">
              Showing {rows.length.toLocaleString("en")} of {matching.toLocaleString("en")} · newest
              first
            </span>
            {cursor && <Button onClick={loadMore}>Load more</Button>}
          </div>
        </>
      )}
      <p className="text-[12.5px] text-fg-3">
        Redeliver sends the same event to the same endpoint again, as a new delivery with a fresh
        set of attempts. Discard takes it out of this list and sends nothing. Either way it stays in
        the history.
      </p>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        {confirming && (
          <DialogContent
            title={`${confirming === "redeliver" ? "Redeliver" : "Discard"} ${deliveryCount(chosen)}?`}
            description={
              confirming === "redeliver"
                ? "Each starts again as a new delivery of the same event to the same endpoint, with a fresh set of attempts."
                : "They leave the dead-letter queue and nothing is sent. They stay in the history."
            }
          >
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Keep them</Button>
              </DialogClose>
              <Button
                variant={confirming === "discard" ? "danger" : "primary"}
                onClick={confirm}
                disabled={busy}
              >
                {busy
                  ? "Working…"
                  : `${confirming === "redeliver" ? "Redeliver" : "Discard"} ${chosen.toLocaleString("en")}`}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
