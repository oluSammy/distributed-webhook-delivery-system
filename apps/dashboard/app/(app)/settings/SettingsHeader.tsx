import classNames from "classnames";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings";

// The top of every Settings page: "Settings › API keys", the section's name, and links to the other
// sections, so they're one click away even with the sidebar collapsed or on a phone.
export function SettingsHeader({ section }: { section: SettingsSection }) {
  const label = SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? "Settings";
  return (
    <>
      <TopBar
        title={label}
        breadcrumb={
          <nav
            aria-label="Breadcrumb"
            className="mb-1 flex items-center gap-1.5 text-[13px] text-fg-3"
          >
            <span>Settings</span>
            <ChevronRight aria-hidden className="size-3.5" />
            <span aria-current="page">{label}</span>
          </nav>
        }
      />
      <nav
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--line)]"
      >
        {SETTINGS_SECTIONS.map(({ id, label: name }) => (
          <Link
            key={id}
            href={`/settings/${id}`}
            aria-current={id === section ? "page" : undefined}
            className={classNames(
              "flex h-[42px] items-center whitespace-nowrap border-b-2 px-3.5 text-[13.5px]",
              id === section
                ? "border-accent text-fg"
                : "border-transparent text-fg-2 hover:text-fg",
            )}
          >
            {name}
          </Link>
        ))}
      </nav>
    </>
  );
}
