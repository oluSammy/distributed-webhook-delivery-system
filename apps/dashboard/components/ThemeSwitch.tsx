"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { applyTheme, isDark } from "@/lib/theme";

// Switches between light and dark, and remembers the choice in this browser. Before anyone
// chooses, the page follows the computer's setting.
export function ThemeSwitch() {
  return (
    <Button
      iconOnly
      aria-label="Switch between light and dark"
      onClick={() => applyTheme(isDark() ? "light" : "dark")}
    >
      <Moon aria-hidden className="dark:hidden" />
      <Sun aria-hidden className="hidden dark:block" />
    </Button>
  );
}
