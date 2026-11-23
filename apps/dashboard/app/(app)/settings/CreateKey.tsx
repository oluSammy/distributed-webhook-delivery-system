"use client";

import { KeyRound, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { apiPost, RequestError } from "@/lib/browser-api";
import type { CreatedApiKey } from "@/lib/keys";

// "Create key": a name in a dialog, then the key itself, shown only once, with how to use it.
export function CreateKey() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!name) {
      setError("Name it after where it will be used, like Production server.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setCreated(await apiPost<CreatedApiKey>("/api/keys", { name }));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn't create it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Closing after the key was shown: start fresh next time, and list the new key.
  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(undefined);
      if (created) {
        setCreated(null);
        router.refresh();
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <KeyRound aria-hidden />
          Create key
        </Button>
      </DialogTrigger>
      {created ? (
        <DialogContent
          locked
          title="Save your API key"
          description={`${created.name} is created. Your code sends it with every request to the API.`}
        >
          <Banner tone="fail" icon={TriangleAlert}>
            <strong>You won't see this key again.</strong> Copy it now and keep it where your code
            reads its secrets, never in the code itself.
          </Banner>
          <CodeBlock code={created.key} copyLabel="Copy API key" />
          <div>
            <p className="mb-2 text-[13px] font-medium">Send an event with it</p>
            <CodeBlock
              language="bash"
              copyLabel="Copy command"
              code={`curl -X POST ${window.location.origin}/api/events \\
  -H "Authorization: Bearer $WEBHOOKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type": "order.paid", "payload": {"order_id": "ord_123"}}'`}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => close(false)}>
              I've saved it
            </Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent
          title="Create API key"
          description="A key lets your code send events and manage endpoints. Make one for each place it runs, so each can be revoked alone."
        >
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field label="Name" error={error} help="Where it will be used, like Production server.">
              {(control) => (
                <Input {...control} name="name" maxLength={100} autoComplete="off" autoFocus />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
