"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiRequest } from "@/lib/browser-api";
import type { Endpoint } from "@/lib/endpoints";
import {
  EndpointFields,
  type FieldErrors,
  readEndpointForm,
  toFieldErrors,
} from "../EndpointFields";

// The Settings tab: the endpoint's fields, filled in, saved with PATCH. A changed URL is checked
// again by the API; new subscriptions apply to events from now on.
export function EditEndpoint({ endpoint }: { endpoint: Endpoint }) {
  const router = useRouter();
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

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
    } catch (error) {
      setErrors(toFieldErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex max-w-xl flex-col gap-4">
      <EndpointFields errors={errors} endpoint={endpoint} />
      <p className="text-[12.5px] text-fg-3">
        New subscriptions apply to events from now on; deliveries already made stay as they are.
      </p>
      <div className="flex gap-2">
        <Button type="reset" onClick={() => setErrors({})}>
          Discard changes
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
