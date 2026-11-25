export type ThemeChoice = "system" | "light" | "dark";

export function currentTheme(): ThemeChoice {
  const saved = document.documentElement.dataset.theme;
  return saved === "light" || saved === "dark" ? saved : "system";
}

// Whether the page is dark right now, whichever way that was decided.
export function isDark(): boolean {
  const choice = currentTheme();
  return choice === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
    : choice === "dark";
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
  try {
    if (choice === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", choice);
    }
  } catch {
    // Storage is blocked (a private window): the choice still works until the page reloads.
  }
}
