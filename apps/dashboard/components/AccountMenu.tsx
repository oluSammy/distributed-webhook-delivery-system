"use client";

import { LogOut } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import type { Me } from "@/lib/api";

// The signed-in person at the bottom of the sidebar, with a menu to sign out.
export function AccountMenu({ me }: { me: Me }) {
  const toast = useToast();
  const { user } = me;

  async function signOut() {
    const response = await fetch("/api/auth/sign-out", { method: "POST" });
    if (!response.ok) {
      toast("Couldn't sign out. Try again.");
      return;
    }
    // A full page load, not a client-side move: nothing from the signed-in pages stays in memory.
    window.location.assign("/sign-in");
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label="Account menu"
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-inset border border-line bg-card-2 p-2.5 text-left"
      >
        {user.avatar_url ? (
          // A plain img: the avatar is GitHub's small square, and next/image would need GitHub's
          // address allowed in next.config.ts for no gain.
          // biome-ignore lint/performance/noImgElement: see above
          <img src={user.avatar_url} alt="" className="size-8 shrink-0 rounded-full" />
        ) : (
          <span aria-hidden className="size-8 shrink-0 rounded-full bg-card-3" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{user.name ?? user.login}</span>
          <span className="block truncate text-xs text-fg-3">@{user.login}</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" side="top">
        <MenuLabel>Signed in with GitHub</MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
