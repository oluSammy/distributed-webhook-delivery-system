"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { apiPost } from "@/lib/browser-api";
import type { CreatedEndpoint } from "@/lib/endpoints";
import {
  EndpointFields,
  type FieldErrors,
  readEndpointForm,
  toFieldErrors,
} from "./EndpointFields";

// How a receiver checks a webhook, in Node.js. Checked against the system's own signing.
const VERIFY_SNIPPET = `import crypto from "node:crypto";

// Checks a webhook before you trust it. rawBody is the request body exactly as it arrived (the
// text, before any JSON parsing); secret is this endpoint's signing secret, "whsec_…".
export function verifyWebhook(headers, rawBody, secret) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  // More than 5 minutes off: it may be an old webhook sent again by someone else.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) {
    return false;
  }
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = crypto.createHmac("sha256", key).update(\`\${id}.\${timestamp}.\${rawBody}\`).digest();
  // While a secret is being rotated there are two signatures, separated by a space.
  return headers["webhook-signature"].split(" ").some((part) => {
    const signature = Buffer.from(part.slice("v1,".length), "base64");
    return (
      part.startsWith("v1,") &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(signature, expected)
    );
  });
}`;

// "Create endpoint": a form in a dialog, then, once created, its signing secret, shown only once.
export function CreateEndpoint({ size = "md" }: { size?: "md" | "lg" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedEndpoint | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrors({});
    try {
      const endpoint = await apiPost<CreatedEndpoint>("/api/endpoints", readEndpointForm(form));
      setCreated(endpoint);
    } catch (error) {
      setErrors(toFieldErrors(error));
    } finally {
      setBusy(false);
    }
  }

  // Closing after the secret was shown: start fresh next time, and show the new endpoint.
  function close(next: boolean) {
    setOpen(next);
    if (!next && created) {
      setCreated(null);
      router.refresh();
    }
    if (!next) {
      setErrors({});
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button variant="primary" size={size}>
          <Plus aria-hidden />
          Create endpoint
        </Button>
      </DialogTrigger>
      {created ? (
        <DialogContent
          locked
          title="Save your signing secret"
          description={`${created.description || created.url} is created. Every webhook to it is signed with this secret, so the receiver can tell it's really from us.`}
        >
          <Banner tone="fail" icon={TriangleAlert}>
            <strong>You won't see this secret again.</strong> Copy it now and keep it where the
            receiver can read it.
          </Banner>
          <CodeBlock code={created.signing_secret} copyLabel="Copy signing secret" />
          <div>
            <p className="mb-2 text-[13px] font-medium">Check each webhook, in Node.js</p>
            <CodeBlock code={VERIFY_SNIPPET} language="javascript" copyLabel="Copy code" />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => close(false)}>
              I've saved it
            </Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent
          title="Create endpoint"
          description="A URL that receives your webhooks. We sign each one, and retry when it's down."
        >
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <EndpointFields errors={errors} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Creating…" : "Create endpoint"}
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
