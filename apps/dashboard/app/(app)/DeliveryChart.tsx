"use client";

import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LocalTime } from "@/components/LocalTime";
import { Table, Td, Th } from "@/components/ui/Table";
import type { Outcomes, Stats } from "@/lib/stats";

type Step = Stats["series"][number];

// The three outcomes, bottom to top in each column, in the same order in the legend and table.
const SERIES: { key: keyof Outcomes; label: string; color: string }[] = [
  { key: "succeeded", label: "Arrived", color: "var(--chart-ok)" },
  { key: "dead", label: "Died", color: "var(--chart-dead)" },
  { key: "pending", label: "Still pending", color: "var(--chart-pend)" },
];

export function DeliveryChart({ stats }: { stats: Stats }) {
  const total = stats.series.reduce(
    (sum, step) => sum + step.succeeded + step.dead + step.pending,
    0,
  );
  if (total === 0) {
    return <p className="py-16 text-center text-fg-2">No deliveries were made in this range.</p>;
  }
  const label = (iso: string) => stepLabel(iso, stats.step_seconds);

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-2">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: series.color }}
            />
            {series.label}
          </li>
        ))}
      </ul>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stats.series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="at"
              tickFormatter={label}
              tick={{ fill: "var(--fg-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tickFormatter={(value: number) => compact.format(value)}
              tick={{ fill: "var(--fg-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "var(--line)" }}
              content={({ active, payload }) => (
                <StepTooltip
                  step={active ? (payload?.[0]?.payload as Step) : undefined}
                  format={label}
                />
              )}
            />
            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                stackId="deliveries"
                fill={series.color}
                maxBarSize={24}
                isAnimationActive={false}
                shape={(props: BarShapeProps) => <Segment {...props} seriesKey={series.key} />}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-fg-2">Show as a table</summary>
        <div className="mt-3">
          <Table label="Deliveries made in each step">
            <thead>
              <tr>
                <Th>From</Th>
                {SERIES.map((series) => (
                  <Th key={series.key} align="right">
                    {series.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.series.map((step) => (
                <tr key={step.at}>
                  <Td>
                    <LocalTime iso={step.at} />
                  </Td>
                  {SERIES.map((series) => (
                    <Td key={series.key} align="right" className="tabular-nums">
                      {step[series.key].toLocaleString("en")}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}

function Segment({ seriesKey, ...props }: BarShapeProps & { seriesKey: keyof Outcomes }) {
  const step = props.payload as Step;
  const above = SERIES.slice(SERIES.findIndex((series) => series.key === seriesKey) + 1);
  const isTop = above.every((series) => step[series.key] === 0);
  return (
    <Rectangle {...props} radius={isTop ? [4, 4, 0, 0] : 0} stroke="var(--card)" strokeWidth={2} />
  );
}

function StepTooltip({
  step,
  format,
}: {
  step: Step | undefined;
  format: (iso: string) => string;
}) {
  if (!step) {
    return null;
  }
  return (
    <div className="rounded-inset border border-line-2 bg-card px-3 py-2 text-[13px] shadow-card">
      <p className="mb-1 text-fg-3">From {format(step.at)}</p>
      {[...SERIES].reverse().map((series) => (
        <p key={series.key} className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: series.color }}
          />
          <strong className="tabular-nums">{step[series.key].toLocaleString("en")}</strong>
          <span className="text-fg-2">{series.label.toLowerCase()}</span>
        </p>
      ))}
    </div>
  );
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

// "14:05" within a day; "Sat 18:00" for the 6-hour steps of 7 days.
function stepLabel(iso: string, stepSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: stepSeconds >= 6 * 3600 ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
