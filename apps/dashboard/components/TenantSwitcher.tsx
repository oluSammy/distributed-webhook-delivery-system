"use client";

import classNames from "classnames";
import { ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import type { Me } from "@/lib/api";

// The tenant the dashboard is showing, and a menu to switch to another of the person's tenants.
// compact: only the tenant's initials, for the collapsed sidebar.
export function TenantSwitcher({ me, compact = false }: { me: Me; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const current = me.tenants.find((tenant) => tenant.id === me.tenant_id);

  async function switchTo(tenantId: string) {
    if (tenantId === me.tenant_id) {
      return;
    }
    const response = await fetch("/api/me/tenant", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    if (!response.ok) {
      toast("Couldn't switch tenant. Try again.");
      return;
    }
    // Start from the Overview (a delivery open now belongs to the old tenant), and ask the server
    // to render the page again with the new tenant's data.
    router.push("/");
    router.refresh();
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Switch tenant, current: ${current?.name ?? "none"}`}
        title={compact ? current?.name : undefined}
        className={classNames(
          "flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 rounded-inset border border-line bg-card-2 py-2 text-left",
          compact ? "justify-center px-0" : "px-2.5",
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-accent-line bg-accent-soft text-[13px] font-bold text-accent"
        >
          {initials(current?.name ?? "?")}
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{current?.name}</span>
              <span className="block text-xs text-fg-3">
                {current?.role === "owner" ? "Owner" : "Member"}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-3" />
          </>
        )}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Tenants</MenuLabel>
        <MenuRadioGroup value={me.tenant_id} onValueChange={switchTo}>
          {me.tenants.map((tenant) => (
            <MenuRadioItem key={tenant.id} value={tenant.id}>
              <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
              <span className="text-xs text-fg-3">
                {tenant.role === "owner" ? "Owner" : "Member"}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

// "Samuel's workspace" → "SW": the first letter of the first two words.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
