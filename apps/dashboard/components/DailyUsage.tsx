import { Meter } from "@/components/ui/Meter";
import { type Usage, usageLevel, usagePercent } from "@/lib/usage";

// Today's events against the daily limit: "1,790 of 50,000 events today (3%)", with a meter.
export function DailyUsage({ usage }: { usage: Usage }) {
  const level = usageLevel(usage);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <strong className="text-[15px] font-semibold tabular-nums">
            {usage.events.toLocaleString("en")}
          </strong>{" "}
          <span className="text-fg-2">
            of {usage.daily_limit.toLocaleString("en")} events today ({usagePercent(usage)}%)
          </span>
        </span>
        <span className="text-[13px] text-fg-3">
          {level === "full" ? "Limit reached · resets at 00:00 UTC" : "Resets at 00:00 UTC"}
        </span>
      </p>
      <Meter
        value={usage.events}
        max={usage.daily_limit}
        tone={level}
        label="Events today, of the daily limit"
      />
    </div>
  );
}
