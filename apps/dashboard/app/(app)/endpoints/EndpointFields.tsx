import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { RequestError } from "@/lib/browser-api";
import type { Endpoint } from "@/lib/endpoints";

// The problems to show, under the field they belong to; "form" for anything else.
export type FieldErrors = Partial<
  Record<"url" | "description" | "subscriptions" | "limits" | "form", string>
>;

// An endpoint's fields, for Create (empty, with the defaults) and Edit (filled in). Uncontrolled:
// the browser keeps what's typed, and readEndpointForm reads it on submit.
export function EndpointFields({ errors, endpoint }: { errors: FieldErrors; endpoint?: Endpoint }) {
  return (
    <>
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
            defaultValue={endpoint?.url}
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
        {(control) => (
          <Input
            {...control}
            name="description"
            defaultValue={endpoint?.description}
            placeholder="Billing service"
          />
        )}
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
            defaultValue={endpoint?.subscriptions.join(", ") ?? "*"}
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
              defaultValue={endpoint?.rate_limit_per_s ?? 50}
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
              defaultValue={endpoint?.concurrency_limit ?? 5}
            />
          )}
        </Field>
      </div>
      {(errors.limits || errors.form) && (
        <p role="alert" className="text-[13px] text-dead">
          {errors.limits ?? errors.form}
        </p>
      )}
    </>
  );
}

// The fields as the API takes them. Subscriptions are typed as text: commas, spaces and new lines
// all separate them.
export function readEndpointForm(form: FormData) {
  return {
    url: String(form.get("url")).trim(),
    description: String(form.get("description")).trim(),
    subscriptions: String(form.get("subscriptions"))
      .split(/[\s,]+/)
      .filter(Boolean),
    rate_limit_per_s: Number(form.get("rate_limit_per_s")),
    concurrency_limit: Number(form.get("concurrency_limit")),
  };
}

// Puts each of the API's complaints under its field. Validation errors name their field in path
// ("url", "subscriptions.0"); a URL the API won't send to (a private address) comes as its own code.
export function toFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof RequestError)) {
    return { form: "Something went wrong. Try again." };
  }
  if (error.code === "endpoint_url_not_allowed") {
    return { url: `${error.message}. Use a public https:// address.` };
  }
  const errors: FieldErrors = {};
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
