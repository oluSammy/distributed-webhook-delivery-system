"use client";

import { type ReactNode, useState } from "react";
import { LocalTime } from "@/components/LocalTime";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Segmented } from "@/components/ui/Segmented";
import { Timeline, TimelineGap, TimelineItem } from "@/components/ui/Timeline";
import type { Attempt, DeliveryDetail } from "@/lib/deliveries";
import { formatDuration, plural } from "@/lib/format";

// Each outcome's word and colour. These four colours are ones both Badge and TimelineItem take.
const OUTCOMES: Record<
  Attempt["outcome"],
  { label: string; tone: "ok" | "fail" | "dead" | "pend" }
> = {
  success: { label: "Success", tone: "ok" },
  failure: { label: "Failure", tone: "fail" },
  throttled: { label: "Throttled", tone: "pend" },
  non_retryable: { label: "Not retried", tone: "dead" },
};

// Every attempt of the delivery, joined by the time between them, and the next one if it's
// scheduled. Newest first by default: when something's wrong, the latest attempt matters most.
export function AttemptTimeline({ delivery }: { delivery: DeliveryDetail }) {
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const upcoming = nextAttempt(delivery);

  // Each attempt with the gap since the one before it (in time order), then put in the order shown.
  const items: ReactNode[] = [];
  delivery.attempts.forEach((attempt, index) => {
    const before = delivery.attempts[index - 1];
    if (before) {
      const gap = Date.parse(attempt.started_at) - Date.parse(before.started_at);
      items.push(
        <TimelineGap key={`gap-${attempt.attempt_number}`}>
          retried {formatDuration(gap)} later
        </TimelineGap>,
      );
    }
    items.push(<AttemptItem key={attempt.attempt_number} attempt={attempt} />);
  });
  if (upcoming) {
    items.push(upcoming);
  }
  if (order === "newest") {
    items.reverse();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-fg-3">
          {delivery.attempts.length === 0
            ? "No attempts yet."
            : plural(delivery.attempts.length, "attempt")}
        </p>
        <Segmented
          label="Order"
          value={order}
          onChange={setOrder}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ]}
        />
      </div>
      {items.length > 0 && <Timeline>{items}</Timeline>}
    </div>
  );
}

function AttemptItem({ attempt }: { attempt: Attempt }) {
  const outcome = OUTCOMES[attempt.outcome];
  const explanation = note(attempt);
  return (
    <TimelineItem marker={String(attempt.attempt_number)} tone={outcome.tone} faded={attempt.stale}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <strong>Attempt {attempt.attempt_number}</strong>
        <Badge tone={outcome.tone}>
          {outcome.label}
          {attempt.stale && " · stale"}
        </Badge>
        <span className="font-mono text-[12.5px]">
          {attempt.response_status ?? attempt.error_kind ?? "—"}
        </span>
        {attempt.latency_ms !== null && (
          <span className="text-fg-3 tabular-nums">{formatDuration(attempt.latency_ms)}</span>
        )}
        <span className="ml-auto text-fg-3">
          <LocalTime iso={attempt.started_at} />
        </span>
      </div>
      {explanation && <p className="text-[13px] text-fg-2">{explanation}</p>}
      {attempt.response_body && (
        <CodeBlock
          code={attempt.response_body}
          language={bodyLanguage(attempt.response_body)}
          copyLabel="Copy response body"
        />
      )}
    </TimelineItem>
  );
}

// The next attempt, dashed, while one is scheduled; or a line saying it's waiting for its endpoint.
function nextAttempt(delivery: DeliveryDetail): ReactNode {
  if (delivery.state !== "pending" || delivery.in_flight) {
    return null;
  }
  const number = (delivery.attempts.at(-1)?.attempt_number ?? 0) + 1;
  return (
    <TimelineItem key="next" marker={String(number)} tone="pend" upcoming>
      <span>
        <strong>Attempt {number}</strong>{" "}
        {delivery.next_attempt_at ? (
          <span className="text-fg-2">
            scheduled for <LocalTime iso={delivery.next_attempt_at} />
          </span>
        ) : (
          <span className="text-fg-2">waits until the endpoint is resumed or recovers</span>
        )}
      </span>
    </TimelineItem>
  );
}

// A sentence for attempts whose status alone doesn't say enough.
function note(attempt: Attempt): string | null {
  if (attempt.stale) {
    return "This result came back after a newer attempt had taken over. It reached the server but changed nothing.";
  }
  if (attempt.outcome === "throttled") {
    return "The endpoint asked us to slow down. Throttled tries don't use up attempts.";
  }
  if (attempt.error_kind === "timeout") {
    return "No response within the request timeout. The receiver may still have processed it.";
  }
  if (attempt.error_kind === "conn_refused") {
    return "Couldn't connect to the endpoint.";
  }
  return null;
}

// Colour a response body as JSON or HTML when it looks like one; otherwise show it plain.
function bodyLanguage(body: string): "json" | "html" | undefined {
  const start = body.trimStart()[0];
  if (start === "{" || start === "[") {
    return "json";
  }
  return start === "<" ? "html" : undefined;
}
