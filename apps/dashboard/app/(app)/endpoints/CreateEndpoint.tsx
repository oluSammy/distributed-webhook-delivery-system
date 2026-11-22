"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { apiPost, RequestError } from "@/lib/browser-api";
import type { CreatedEndpoint } from "@/lib/endpoints";

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

type Errors = Partial<Record<"url" | "description" | "subscriptions" | "limits" | "form", string>>;

// "Create endpoint": a form in a dialog, then, once created, its signing secret, shown only once.
export function CreateEndpoint({ size = "md" }: { size?: "md" | "lg" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedEndpoint | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrors({});
    try {
      const endpoint = await apiPost<CreatedEndpoint>("/api/endpoints", {
        url: String(form.get("url")).trim(),
        description: String(form.get("description")).trim(),
        // "order.*, invoice.paid" or one per line: commas, spaces and new lines all separate.
        subscriptions: String(form.get("subscriptions"))
          .split(/[\s,]+/)
          .filter(Boolean),
        rate_limit_per_s: Number(form.get("rate_limit_per_s")),
        concurrency_limit: Number(form.get("concurrency_limit")),
      });
      setCreated(endpoint);
    } catch (error) {
      setErrors(toErrors(error));
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
            <Field
              label="URL"
              error={errors.url}
              help="Must be https:// and reachable from the internet."
            >
              {(control) => (
                <Input
                  {...control}
                  name="url"
                  type="url"
                  required
                  placeholder="https://example.com/webhooks"
                  className="font-mono"
                />
              )}
            </Field>
            <Field
              label="Description"
              error={errors.description}
              help="Shown in lists and notifications."
            >
              {(control) => <Input {...control} name="description" placeholder="Billing service" />}
            </Field>
            <Field
              label="Subscriptions"
              error={errors.subscriptions}
              help="Event types it receives: an exact type (order.paid), a prefix (order.*), or * for everything. Separate them with commas."
            >
              {(control) => (
                <Input
                  {...control}
                  name="subscriptions"
                  defaultValue="*"
                  required
                  className="font-mono"
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rate limit (per second)" help="1–10,000">
                {(control) => (
                  <Input
                    {...control}
                    name="rate_limit_per_s"
                    type="number"
                    min={1}
                    max={10000}
                    defaultValue={50}
                  />
                )}
              </Field>
              <Field label="Sent at once" help="1–100">
                {(control) => (
                  <Input
                    {...control}
                    name="concurrency_limit"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={5}
                  />
                )}
              </Field>
            </div>
            {(errors.limits || errors.form) && (
              <p role="alert" className="text-[13px] text-dead">
                {errors.limits ?? errors.form}
              </p>
            )}
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

// Puts each of the API's complaints under its field. Validation errors name their field in path
// ("url", "subscriptions.0"); a URL the API won't send to (a private address) comes as its own code.
function toErrors(error: unknown): Errors {
  if (!(error instanceof RequestError)) {
    return { form: "Something went wrong. Try again." };
  }
  if (error.code === "endpoint_url_not_allowed") {
    return { url: `${error.message}. Use a public https:// address.` };
  }
  const errors: Errors = {};
  for (const { path, message } of error.details) {
    const field = path.split(".")[0];
    if (field === "url" || field === "description" || field === "subscriptions") {
      errors[field] ??= message;
    } else {
      errors.limits ??= `${field === "rate_limit_per_s" ? "Rate limit" : "Sent at once"}: ${message}`;
    }
  }
  return error.details.length > 0 ? errors : { form: error.message };
}
