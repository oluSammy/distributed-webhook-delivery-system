import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyUsage } from "@/components/DailyUsage";
import { LocalTime } from "@/components/LocalTime";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { apiGet, getMe } from "@/lib/api";
import type { EventType } from "@/lib/event-types";
import type { ApiKey } from "@/lib/keys";
import type { RetryPolicy } from "@/lib/retry-policy";
import type { Usage } from "@/lib/usage";
import { CreateKey } from "./CreateKey";
import { EventTypes } from "./EventTypes";
import { RetryPolicyForm } from "./RetryPolicyForm";
import { RevokeKey } from "./RevokeKey";
import { TenantName } from "./TenantName";

export const metadata: Metadata = { title: "Settings · Webhooks" };

export default function SettingsPage() {
  return (
    <>
      <TopBar
        title="Settings"
        subtitle="This workspace's name, keys, event types, retries and usage"
      />
      <Suspense fallback={<LoadingSettings />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const [me, { keys }, { event_types }, policy, usage] = await Promise.all([
    getMe(),
    apiGet<{ keys: ApiKey[] }>("/api/keys"),
    apiGet<{ event_types: EventType[] }>("/api/event-types"),
    apiGet<RetryPolicy>("/api/retry-policy"),
    apiGet<Usage>("/api/usage"),
  ]);
  const tenant = me.tenants.find((t) => t.id === me.tenant_id);
  // The API checks this again on every change; here it only decides which buttons to show.
  const isOwner = tenant?.role === "owner";

  return (
    <>
      <Card aria-labelledby="general-h">
        <h2 id="general-h" className="mb-4 text-[15px] font-semibold">
          General
        </h2>
        <TenantName name={tenant?.name ?? ""} canEdit={isOwner} />
      </Card>

      <Card aria-labelledby="keys-h" id="api-keys" className="scroll-mt-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="keys-h" className="text-[15px] font-semibold">
              API keys
            </h2>
            <p className="max-w-xl text-fg-3">
              Your code sends one with each request, as{" "}
              <code className="font-mono text-[12.5px]">Authorization: Bearer …</code>. Only owners
              can create or revoke them.
            </p>
          </div>
          {isOwner && <CreateKey />}
        </div>
        {keys.length === 0 ? (
          <p className="text-fg-2">
            No API keys yet.{" "}
            {isOwner ? "Create one for your code to send events." : "Ask an owner to create one."}
          </p>
        ) : (
          <Table label="API keys">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Key</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                {isOwner && (
                  <Th align="right">
                    <span className="sr-only">Revoke</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const label = key.name || `${key.prefix}…`;
                return (
                  <tr key={key.id}>
                    <Td>
                      {key.name ? (
                        <span className="font-medium">{key.name}</span>
                      ) : (
                        <span className="text-fg-3">No name</span>
                      )}
                    </Td>
                    <Td>
                      <span className="font-mono text-[12.5px]">{key.prefix}…</span>
                    </Td>
                    <Td>
                      <LocalTime iso={key.created_at} />
                    </Td>
                    <Td>
                      {key.last_used_at ? (
                        <LocalTime iso={key.last_used_at} />
                      ) : (
                        <span className="text-fg-3">Never</span>
                      )}
                    </Td>
                    {isOwner && (
                      <Td align="right">
                        <RevokeKey apiKey={key} label={label} />
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Card aria-labelledby="types-h" id="event-types" className="scroll-mt-5">
        <h2 id="types-h" className="text-[15px] font-semibold">
          Event types
        </h2>
        <p className="mb-4 max-w-xl text-fg-3">
          The types your code may send. An endpoint receives the ones its subscriptions match.
        </p>
        <EventTypes types={event_types} />
      </Card>

      <Card aria-labelledby="retries-h">
        <h2 id="retries-h" className="text-[15px] font-semibold">
          Retry policy
        </h2>
        <p className="mb-4 max-w-xl text-fg-3">
          When an endpoint fails, how often to try again, and when to give up and move the delivery
          to the dead-letter queue.
        </p>
        <RetryPolicyForm policy={policy} canEdit={isOwner} />
      </Card>
      <Card aria-labelledby="usage-h" id="usage" className="scroll-mt-5">
        <h2 id="usage-h" className="text-[15px] font-semibold">
          Usage
        </h2>
        <p className="mb-4 max-w-xl text-fg-3">
          Every workspace may send {usage.daily_limit.toLocaleString("en")} events a day (UTC).
        </p>
        <DailyUsage usage={usage} />
        <ul className="mt-4 flex max-w-2xl list-disc flex-col gap-1 pl-5 text-fg-2">
          <li>
            At the limit, <code className="font-mono text-[12.5px]">POST /api/events</code> answers{" "}
            <code className="font-mono text-[12.5px]">429</code> with{" "}
            <code className="font-mono text-[12.5px]">Retry-After</code>, the seconds until 00:00
            UTC. A batch that would go over is refused whole.
          </li>
          <li>
            Every accepted event's answer says what's left:{" "}
            <code className="font-mono text-[12.5px]">RateLimit-Remaining</code>.
          </li>
          <li>Repeats of an Idempotency-Key, and refused requests, don't count.</li>
        </ul>
      </Card>
    </>
  );
}

function LoadingSettings() {
  return (
    <section aria-busy="true" aria-label="Loading settings" className="flex flex-col gap-5">
      <Skeleton className="h-36 w-full rounded-card" />
      <Skeleton className="h-64 w-full rounded-card" />
      <Skeleton className="h-64 w-full rounded-card" />
      <Skeleton className="h-40 w-full rounded-card" />
    </section>
  );
}
