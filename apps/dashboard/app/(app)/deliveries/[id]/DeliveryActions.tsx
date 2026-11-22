"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import type { Delivery } from "@/lib/deliveries";

// What can be done with this delivery: cancel it while it's pending; redeliver or discard it while
// it's dead and still in the dead-letter queue. Each asks first.
export function DeliveryActions({ delivery }: { delivery: Delivery }) {
  if (delivery.state === "pending") {
    return (
      <Confirm
        trigger={<Button variant="danger">Cancel delivery</Button>}
        title="Cancel this delivery?"
        description="It won't be sent again. If an attempt is being sent right now, that one still finishes, but its result won't change anything."
        confirm="Cancel delivery"
        danger
        path={`/api/deliveries/${delivery.id}/cancel`}
        done="Delivery cancelled"
      />
    );
  }
  if (delivery.state === "dead" && delivery.resolution === null) {
    return (
      <div className="flex gap-2">
        <Confirm
          trigger={<Button>Discard</Button>}
          title="Discard this dead delivery?"
          description="It leaves the dead-letter queue and nothing is sent. It stays here as history."
          confirm="Discard"
          path={`/api/dlq/${delivery.id}/discard`}
          done="Delivery discarded"
        />
        <Confirm
          trigger={
            <Button variant="primary">
              <RotateCcw aria-hidden />
              Redeliver
            </Button>
          }
          title="Redeliver this event to this endpoint?"
          description="A new delivery of the same event starts, with a fresh set of attempts. This one stays as history, marked as redelivered."
          confirm="Redeliver"
          path={`/api/dlq/${delivery.id}/redeliver`}
          done="Redelivery started"
          openNew
        />
      </div>
    );
  }
  return null;
}

// A button that opens a confirmation, then POSTs to path. openNew goes to the delivery the API
// created (a redelivery); otherwise the page renders again to show the change.
function Confirm({
  trigger,
  title,
  description,
  confirm,
  danger = false,
  path,
  done,
  openNew = false,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  path: string;
  done: string;
  openNew?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(path, { method: "POST" });
      if (response.status === 401) {
        window.location.assign("/sign-in?error=expired");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        toast(body.error?.message ?? "That didn't work. Try again.");
        return;
      }
      setOpen(false);
      toast(done);
      if (openNew && body.id) {
        router.push(`/deliveries/${body.id}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Keep it</Button>
          </DialogClose>
          <Button variant={danger ? "danger" : "primary"} onClick={run} disabled={busy}>
            {busy ? "Working…" : confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
