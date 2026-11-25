"use client";

import classNames from "classnames";
import { LogOut } from "lucide-react";
import { useState } from "react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import type { Me } from "@/lib/api";
import { applyTheme, currentTheme, type ThemeChoice } from "@/lib/theme";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// The signed-in person at the bottom of the sidebar, with a menu for the theme and signing out.
// compact: only the avatar, for the collapsed sidebar.
export function AccountMenu({ me, compact = false }: { me: Me; compact?: boolean }) {
  const toast = useToast();
  const { user } = me;
  // Read when the menu opens: the top bar's switch may have changed it meanwhile.
  const [theme, setTheme] = useState<ThemeChoice>("system");

  async function signOut() {
    const response = await fetch("/api/auth/sign-out", { method: "POST" });
    if (!response.ok) {
      toast("Couldn't sign out. Try again.");
      return;
    }
    // A full page load, not a client-side move: nothing from the signed-in pages stays in memory.
    window.location.assign("/sign-in");
  }

  function chooseTheme(value: string) {
    const choice = value as ThemeChoice;
    applyTheme(choice);
    setTheme(choice);
  }

  return (
    <Menu onOpenChange={(open) => open && setTheme(currentTheme())}>
      <MenuTrigger
        aria-label={`Account menu: ${user.login}, theme, sign out`}
        title={compact ? `@${user.login}` : undefined}
        className={classNames(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-inset border border-line bg-card-2 p-2.5 text-left",
          compact && "justify-center px-0",
        )}
      >
        {user.avatar_url ? (
          // A plain img: the avatar is GitHub's small square, and next/image would need GitHub's
          // address allowed in next.config.ts for no gain.
          // biome-ignore lint/performance/noImgElement: see above
          <img src={user.avatar_url} alt="" className="size-8 shrink-0 rounded-full" />
        ) : (
          <span aria-hidden className="size-8 shrink-0 rounded-full bg-card-3" />
        )}
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{user.name ?? user.login}</span>
            <span className="block truncate font-mono text-xs text-fg-3">@{user.login}</span>
          </span>
        )}
      </MenuTrigger>
      <MenuContent align="start" side="top">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={chooseTheme}>
          {THEMES.map(({ value, label }) => (
            <MenuRadioItem key={value} value={value}>
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Signed in with GitHub</MenuLabel>
        <MenuItem onSelect={signOut}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
