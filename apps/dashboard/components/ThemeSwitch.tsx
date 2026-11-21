"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Switches between light and dark, and remembers the choice in this browser. Before anyone
// chooses, the page follows the computer's setting. The script in layout.tsx applies a saved
// choice before the page first paints, so there's no flash of the wrong theme.
export function ThemeSwitch() {
  function toggle() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage is blocked (a private window): the switch still works until the page reloads.
    }
  }

  return (
    <Button iconOnly aria-label="Switch between light and dark" onClick={toggle}>
      {/* Both icons are drawn: the moon in light mode, the sun in dark mode. */}
      <Moon aria-hidden className="dark:hidden" />
      <Sun aria-hidden className="hidden dark:block" />
    </Button>
  );
}
