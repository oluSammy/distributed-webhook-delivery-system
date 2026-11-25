import type { Metadata } from "next";
import { Suspense } from "react";
import { LocalTime } from "@/components/LocalTime";
import { Card } from "@/components/ui/Card";
import { Table, Td, Th } from "@/components/ui/Table";
import { apiGet, getMe } from "@/lib/api";
import type { ApiKey } from "@/lib/keys";
import { CreateKey } from "../CreateKey";
import { OwnersOnly } from "../OwnersOnly";
import { RevokeKey } from "../RevokeKey";
import { SettingsHeader } from "../SettingsHeader";
import { SettingsLoading } from "../SettingsLoading";

export const metadata: Metadata = { title: "API keys · Settings · Webhooks" };

export default function ApiKeysSettingsPage() {
  return (
    <>
      <SettingsHeader section="api-keys" />
      <Suspense fallback={<SettingsLoading />}>
        <Keys />
      </Suspense>
    </>
  );
}

// The keys your code sends events with. Owners create and revoke them; members see the list.
async function Keys() {
  const [me, { keys }] = await Promise.all([getMe(), apiGet<{ keys: ApiKey[] }>("/api/keys")]);
  const tenant = me.tenants.find((t) => t.id === me.tenant_id);
  // The API checks this again on every change; here it only decides which buttons to show.
  const isOwner = tenant?.role === "owner";

  return (
    <>
      {!isOwner && <OwnersOnly tenant={tenant?.name ?? "this workspace"} />}
      <Card aria-labelledby="keys-h">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="keys-h" className="text-[15px] font-semibold">
              API keys
            </h2>
            <p className="max-w-xl text-fg-3">
              Keys are for your code, not for people: it sends one with each request, as{" "}
              <code className="font-mono text-[12.5px]">Authorization: Bearer …</code>.
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
        <p className="mt-3 text-[12.5px] text-fg-3">
          Revoking is immediate: requests using that key are refused from then on.
        </p>
      </Card>
    </>
  );
}
