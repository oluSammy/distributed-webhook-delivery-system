"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { apiRequest, RequestError } from "@/lib/browser-api";
import { describePolicy, type RetryPolicy } from "@/lib/retry-policy";

// Each field in the unit people think in, with the API's limits (packages/core/src/backoff.ts)
// in that unit. unit is how many seconds one of it is.
const FIELDS = [
  { key: "max_attempts", label: "Attempts", unit: 1, suffix: "", min: 1, max: 25 },
  { key: "base_seconds", label: "First retry within", unit: 1, suffix: "s", min: 10, max: 3600 },
  { key: "cap_seconds", label: "Longest wait", unit: 60, suffix: "min", min: 1, max: 360 },
  { key: "max_age_seconds", label: "Give up after", unit: 60, suffix: "min", min: 1, max: 4320 },
] as const;

type Key = (typeof FIELDS)[number]["key"];

// The retry policy: owners edit it, with a sentence that says what the numbers mean as they type;
// members see the sentence.
export function RetryPolicyForm({ policy, canEdit }: { policy: RetryPolicy; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(() => toFormValues(policy));
  const [errors, setErrors] = useState<Partial<Record<Key | "form", string>>>({});
  const [busy, setBusy] = useState(false);

  const draft = toPolicy(values);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      setErrors({ form: "Fill in every number." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await apiRequest("PUT", "/api/retry-policy", draft);
      toast("Retry policy saved");
      router.refresh();
    } catch (err) {
      setErrors(toErrors(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1.5">
        <p>{describePolicy(policy)}</p>
        <p className="text-[12.5px] text-fg-3">Only owners can change it.</p>
      </div>
    );
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <div className="grid max-w-2xl gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            help={`${field.min}–${field.max.toLocaleString("en")}${field.suffix ? ` ${field.suffix}` : ""}`}
            error={errors[field.key]}
          >
            {(control) => (
              <div className="relative">
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={field.min}
                  max={field.max}
                  step={1}
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className={field.suffix ? "pr-12 tabular-nums" : "tabular-nums"}
                />
                {field.suffix && (
                  <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[13px] text-fg-3">
                    {field.suffix}
                  </span>
                )}
              </div>
            )}
          </Field>
        ))}
      </div>
      <p aria-live="polite" className="max-w-2xl text-fg-2">
        {draft ? describePolicy(draft) : "Fill in every number to see what it means."}
      </p>
      {errors.form && (
        <p role="alert" className="text-[13px] text-dead">
          {errors.form}
        </p>
      )}
      <p className="text-[12.5px] text-fg-3">
        Changes apply from each delivery's next attempt, including deliveries already waiting.
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setValues(toFormValues(policy));
            setErrors({});
          }}
        >
          Discard changes
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

// The policy's seconds as the form's units, as text for the boxes.
function toFormValues(policy: RetryPolicy): Record<Key, string> {
  return Object.fromEntries(
    FIELDS.map((field) => [field.key, String(Math.round(policy[field.key] / field.unit))]),
  ) as Record<Key, string>;
}

// Back to seconds; null while a box is empty or not a whole number. The limits are left to the
// API, which says which field is out of range.
function toPolicy(values: Record<Key, string>): RetryPolicy | null {
  const policy: Partial<RetryPolicy> = {};
  for (const field of FIELDS) {
    const number = Number(values[field.key]);
    if (values[field.key].trim() === "" || !Number.isInteger(number)) {
      return null;
    }
    policy[field.key] = number * field.unit;
  }
  return policy as RetryPolicy;
}

// The API's 400 names each field that's out of range; its message is in seconds, so the field's
// own range (in its unit) is shown instead.
function toErrors(err: unknown): Partial<Record<Key | "form", string>> {
  if (!(err instanceof RequestError) || err.details.length === 0) {
    return { form: err instanceof Error ? err.message : "Couldn't save it. Try again." };
  }
  const errors: Partial<Record<Key | "form", string>> = {};
  for (const { path } of err.details) {
    const field = FIELDS.find((f) => f.key === path.split(".")[0]);
    if (field?.key === "cap_seconds" && !errors.cap_seconds) {
      errors.cap_seconds = "At least the first retry's wait, and 1–360 min.";
    } else if (field) {
      errors[field.key] ??=
        `Between ${field.min} and ${field.max.toLocaleString("en")}${field.suffix ? ` ${field.suffix}` : ""}.`;
    }
  }
  return Object.keys(errors).length > 0 ? errors : { form: err.message };
}
