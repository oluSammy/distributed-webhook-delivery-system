// An id shortened to its start and end, with the full id on hover and a copy button:
// 3f9d2a10-8b6e-7c41-a5f0-1d2e7b9c4e05 shows as 3f9d2a10…4e05. label says what it is, for the
import { CopyButton } from "./CopyButton";

// copy button: "delivery id".
export function ShortId({ id, label }: { id: string; label: string }) {
  const short = id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="font-mono text-[12.5px]" title={id}>
        {short}
      </span>
      <CopyButton value={id} label={`Copy ${label}`} />
    </span>
  );
}
