import classNames from "classnames";

// How tones look: the fill carries the severity, the track is a lighter step of the same colour.
const tones = {
  ok: { fill: "bg-accent", track: "bg-accent-soft" },
  high: { fill: "bg-fail", track: "bg-fail-soft" },
  full: { fill: "bg-dead", track: "bg-dead-soft" },
};

// A bar filled to value out of max, like "1,790 of 50,000". Screen readers get the browser's own
// <meter>, with its label and numbers; the bar is drawn beside it for the eye, since a native
// meter can't be styled the same in every browser. The words next to it say the same, so the
// colour is never the only signal.
export function Meter({
  value,
  max,
  label,
  tone = "ok",
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: keyof typeof tones;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={className}>
      <meter
        className="sr-only"
        aria-label={label}
        min={0}
        max={max}
        value={Math.min(value, max)}
      />
      <div
        aria-hidden
        className={classNames("h-2 w-full overflow-hidden rounded-full", tones[tone].track)}
      >
        <div
          className={classNames("h-full rounded-full", tones[tone].fill)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
