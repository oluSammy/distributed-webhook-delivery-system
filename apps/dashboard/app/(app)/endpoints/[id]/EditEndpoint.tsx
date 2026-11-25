"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { apiRequest } from "@/lib/browser-api";
import type { Endpoint } from "@/lib/endpoints";
import {
  EndpointFields,
  type FieldErrors,
  readEndpointForm,
  toFieldErrors,
} from "../EndpointFields";

export function EditEndpoint({
  endpoint,
  onSaved,
  onCancel,
}: {
  endpoint: Endpoint;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  // Discard puts every field back. The subscriptions are kept in React, which a form reset doesn't
  // reach, so the fields are drawn again from scratch instead.
  const [drawn, setDrawn] = useState(0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await apiRequest(
        "PATCH",
        `/api/endpoints/${endpoint.id}`,
        readEndpointForm(new FormData(event.currentTarget)),
      );
      toast("Changes saved");
      router.refresh();
      onSaved?.();
    } catch (error) {
      setErrors(toFieldErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex max-w-xl flex-col gap-4">
      <EndpointFields key={drawn} errors={errors} endpoint={endpoint} />
      <p className="text-[12.5px] text-fg-3">
        New subscriptions apply to events from now on; deliveries already made stay as they are.
      </p>
      <div className={onCancel ? "flex justify-end gap-2" : "flex gap-2"}>
        {onCancel ? (
          <Button onClick={onCancel}>Cancel</Button>
        ) : (
          <Button
            onClick={() => {
              setErrors({});
              setDrawn(drawn + 1);
            }}
          >
            Discard changes
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function EditEndpointDialog({ endpoint }: { endpoint: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Pencil aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit endpoint">
        <EditEndpoint
          endpoint={endpoint}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
