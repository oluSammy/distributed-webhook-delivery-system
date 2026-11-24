import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import type { Onboarding } from "@/lib/onboarding";

// "Send your first webhook": four steps, each done once what it asks for exists. Each button goes
// to the page that already does it; coming back here shows the step done. On Overview until all
// four are done.
export function GetStarted({ onboarding, origin }: { onboarding: Onboarding; origin: string }) {
  const { steps, event_type: type } = onboarding;
  const list: { done: boolean; title: string; detail: string; action: ReactNode }[] = [
    {
      done: steps.event_type,
      title: "Register an event type",
      detail:
        "Names something that happens in your product, like order.paid. Only registered types are accepted.",
      action: <ActionLink href="/settings#event-types">Add event type</ActionLink>,
    },
    {
      done: steps.endpoint,
      title: "Create an endpoint",
      detail: "The URL we send your webhooks to. Its signing secret is shown once: save it.",
      action: <ActionLink href="/endpoints">Create endpoint</ActionLink>,
    },
    {
      done: steps.delivered,
      title: "Send a test and see it arrive",
      detail: "One signed sample webhook to your endpoint, with the response it gave back.",
      action: onboarding.endpoint_id ? (
        <ActionLink href={`/endpoints/${onboarding.endpoint_id}`}>Send a test</ActionLink>
      ) : null,
    },
    {
      done: steps.event_sent,
      title: "Send an event from your code",
      detail:
        "Create an API key, then report an event with it. Every endpoint subscribed to its type gets a webhook.",
      action: <ActionLink href="/settings#api-keys">Create API key</ActionLink>,
    },
  ];
  const doneCount = list.filter((step) => step.done).length;
  const current = list.findIndex((step) => !step.done);

  return (
    <Card aria-labelledby="get-started-h">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="get-started-h" className="text-[17px] font-semibold">
          Send your first webhook
        </h2>
        <p className="text-[13px] text-fg-3 tabular-nums">{doneCount} of 4 done</p>
      </div>
      <ol className="flex flex-col divide-y divide-line">
        {list.map((step, index) => (
          <li key={step.title} className="flex flex-wrap items-start gap-x-3.5 gap-y-2 py-3.5">
            <span
              className={
                step.done
                  ? "grid size-7 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"
                  : index === current
                    ? "grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"
                    : "grid size-7 shrink-0 place-items-center rounded-full border border-line-2 text-fg-3"
              }
            >
              {step.done ? (
                <Check aria-label="Done" className="size-4" />
              ) : (
                <span className="text-[13px] font-semibold">{index + 1}</span>
              )}
            </span>
            <div className="min-w-0 flex-[1_1_240px]">
              <p className={step.done ? "font-medium text-fg-2 line-through" : "font-medium"}>
                {step.title}
              </p>
              {!step.done && <p className="mt-0.5 text-fg-3">{step.detail}</p>}
              {!step.done && index === 3 && type && (
                <div className="mt-3">
                  <p className="mb-2 text-[13px] text-fg-2">
                    With the key in <code className="font-mono">WEBHOOKS_API_KEY</code>, from a
                    terminal:
                  </p>
                  <CodeBlock
                    language="bash"
                    copyLabel="Copy command"
                    code={`curl -X POST ${origin}/api/events \\
  -H "Authorization: Bearer $WEBHOOKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type": "${type}", "payload": {"hello": "world"}}'`}
                  />
                </div>
              )}
            </div>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button size="sm" asChild>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
