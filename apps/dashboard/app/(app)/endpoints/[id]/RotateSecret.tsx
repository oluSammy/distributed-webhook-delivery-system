"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { apiPost, RequestError } from "@/lib/browser-api";

type Rotated = { signing_secret: string; previous_expires_at: string | null };

// Rotate secret: a new signing secret, shown once; the old one keeps signing for 24 hours, so every
// webhook carries both signatures while the receiver switches over. In the page's header and on
// the Secrets tab.
export function RotateSecret({ endpointId }: { endpointId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<Rotated | null>(null);

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      setRotated(await apiPost<Rotated>(`/api/endpoints/${endpointId}/rotate-secret`));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn't rotate it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setRotated(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button>
          <RotateCw aria-hidden />
          Rotate secret
        </Button>
      </DialogTrigger>
      {rotated ? (
        <DialogContent
          locked
          title="Save the new signing secret"
          description="Update the receiver to use it. Until then, it keeps accepting webhooks with the old one."
        >
          <Banner tone="fail" icon={TriangleAlert}>
            <strong>You won't see this secret again.</strong> Copy it now.
          </Banner>
          <CodeBlock code={rotated.signing_secret} copyLabel="Copy signing secret" />
          {rotated.previous_expires_at && (
            <p className="text-fg-2">
              The old secret stops signing at <LocalTime iso={rotated.previous_expires_at} />.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => close(false)}>
              I've saved it
            </Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent
          title="Rotate the signing secret?"
          description="A new secret is made and shown once. The old one keeps working for 24 hours, then stops."
        >
          {error && (
            <p role="alert" className="text-[13px] text-dead">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={rotate} disabled={busy}>
              {busy ? "Rotating…" : "Rotate secret"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
