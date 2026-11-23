"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { apiRequest, RequestError } from "@/lib/browser-api";
import type { ApiKey } from "@/lib/keys";

// Revoke, after saying what it does: code still using the key starts getting 401 straight away.
export function RevokeKey({ apiKey, label }: { apiKey: ApiKey; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/keys/${apiKey.id}`);
      toast(`${label} revoked`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof RequestError ? err.message : "Couldn't revoke it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="danger" aria-label={`Revoke ${label}`}>
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Revoke ${label}?`}
        description="This can't be undone. Anything still using it gets 401 Unauthorized from now on, so switch it to another key first."
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="danger" onClick={revoke} disabled={busy}>
            {busy ? "Revoking…" : "Revoke key"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
