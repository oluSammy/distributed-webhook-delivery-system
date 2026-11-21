import { CircleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";

// What a control inside a Field needs, so its label and messages are tied to it.
type ControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

// A label, a control, and a help or error message under it. Clicking the label focuses the
export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? help;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": message ? messageId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={messageId} className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-dead">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        help && (
          <p id={messageId} className="mt-1.5 text-[12.5px] text-fg-3">
            {help}
          </p>
        )
      )}
    </div>
  );
}
