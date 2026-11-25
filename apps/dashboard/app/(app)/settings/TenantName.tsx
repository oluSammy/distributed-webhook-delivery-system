"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { apiRequest, RequestError } from "@/lib/browser-api";

// The tenant's name: shown in the sidebar's switcher and to everyone in it. Owners can change it;
// members see it, without the box to edit.
export function TenantName({ name, canEdit }: { name: string; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get("name")).trim();
    if (!next) {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest("PATCH", "/api/tenant", { name: next });
      toast("Name saved");
      router.refresh(); // the sidebar's switcher shows the new name
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn't save it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div>
        <p className="text-[13px] font-medium">Name</p>
        <p className="mt-1">{name}</p>
      </div>
    );
  }
  return (
    <form onSubmit={save} noValidate className="flex max-w-md flex-col gap-3">
      <Field label="Name" error={error} help="Everyone in it sees this name.">
        {(control) => (
          <Input {...control} name="name" defaultValue={name} maxLength={100} autoComplete="off" />
        )}
      </Field>
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
