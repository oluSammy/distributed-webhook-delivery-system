import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { getMe } from "@/lib/api";
import { OwnersOnly } from "../OwnersOnly";
import { SettingsHeader } from "../SettingsHeader";
import { SettingsLoading } from "../SettingsLoading";
import { TenantName } from "../TenantName";

export const metadata: Metadata = { title: "General · Settings · Webhooks" };

export default function GeneralSettingsPage() {
  return (
    <>
      <SettingsHeader section="general" />
      <Suspense fallback={<SettingsLoading />}>
        <General />
      </Suspense>
    </>
  );
}

// The workspace's name (owners change it) and its id, for support or the API.
async function General() {
  const me = await getMe();
  const tenant = me.tenants.find((t) => t.id === me.tenant_id);
  const isOwner = tenant?.role === "owner";
  return (
    <>
      {!isOwner && <OwnersOnly tenant={tenant?.name ?? "this workspace"} />}
      <Card aria-labelledby="workspace-h" className="flex flex-col gap-5">
        <h2 id="workspace-h" className="text-[15px] font-semibold">
          Workspace
        </h2>
        <TenantName name={tenant?.name ?? ""} canEdit={isOwner} />
        <div>
          <p className="text-[13px] font-medium">Workspace id</p>
          <p className="mt-1 flex items-center gap-1.5">
            <code className="font-mono text-[12.5px] break-all text-fg-2">{me.tenant_id}</code>
            <CopyButton value={me.tenant_id} label="Copy workspace id" />
          </p>
        </div>
      </Card>
    </>
  );
}
