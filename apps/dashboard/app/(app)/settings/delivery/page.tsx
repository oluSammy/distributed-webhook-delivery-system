import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { apiGet, getMe } from "@/lib/api";
import type { RetryPolicy } from "@/lib/retry-policy";
import { OwnersOnly } from "../OwnersOnly";
import { RetryPolicyForm } from "../RetryPolicyForm";
import { SettingsHeader } from "../SettingsHeader";
import { SettingsLoading } from "../SettingsLoading";

export const metadata: Metadata = { title: "Delivery settings · Settings · Webhooks" };

export default function DeliverySettingsPage() {
  return (
    <>
      <SettingsHeader section="delivery" />
      <Suspense fallback={<SettingsLoading />}>
        <Delivery />
      </Suspense>
    </>
  );
}

// The retry policy: owners change it; members see what it means.
async function Delivery() {
  const [me, policy] = await Promise.all([getMe(), apiGet<RetryPolicy>("/api/retry-policy")]);
  const tenant = me.tenants.find((t) => t.id === me.tenant_id);
  const isOwner = tenant?.role === "owner";
  return (
    <>
      {!isOwner && <OwnersOnly tenant={tenant?.name ?? "this workspace"} />}
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
    </>
  );
}
