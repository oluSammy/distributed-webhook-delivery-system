import { formatDuration } from "@/lib/format";
import { type RetryPolicy, retryCeilingSeconds } from "@/lib/retry-policy";

// What a policy means, attempt by attempt: the first try goes at once, and each retry waits a
// random time up to its ceiling, which doubles after each failure. The longest it can all take is
// the sum of those ceilings, cut short by the maximum age.
export function RetrySchedule({ policy }: { policy: RetryPolicy }) {
  const rows: { attempt: number; wait: number; latest: number }[] = [];
  let latest = 0;
  for (let attempt = 2; attempt <= policy.max_attempts; attempt += 1) {
    const wait = retryCeilingSeconds(policy, attempt - 1);
    latest += wait;
    rows.push({ attempt, wait, latest });
  }
  const givesUp = Math.min(latest, policy.max_age_seconds);
  const time = (seconds: number) => formatDuration(seconds * 1000);

  return (
    <section aria-labelledby="schedule-h" className="flex flex-col gap-3">
      <div>
        <h3 id="schedule-h" className="font-semibold">
          Resulting schedule
        </h3>
        <p className="text-[12.5px] text-fg-3">
          Each wait is random, up to the time shown. Throttled tries (429) don't count as attempts.
        </p>
      </div>
      <ol className="flex flex-col gap-1.5">
        <li className="flex items-center justify-between gap-3 rounded-inset border border-line bg-card-2 px-3.5 py-2">
          <span>Attempt 1</span>
          <span className="font-mono text-[12.5px] text-fg-2">right away</span>
        </li>
        {rows.map((row) => (
          <li
            key={row.attempt}
            className="flex items-center justify-between gap-3 rounded-inset border border-line bg-card-2 px-3.5 py-2"
          >
            <span>Attempt {row.attempt}</span>
            <span className="font-mono text-[12.5px] text-fg-2">
              waits up to {time(row.wait)}
              {row.latest > policy.max_age_seconds && " · may be past the maximum age"}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-fg-2">
        {policy.max_attempts === 1 ? (
          "A failed delivery isn't retried: it goes straight to the dead-letter queue."
        ) : (
          <>
            Gives up after at most <strong className="tabular-nums">{time(givesUp)}</strong>, then
            the delivery goes to the dead-letter queue.
          </>
        )}
      </p>
    </section>
  );
}
