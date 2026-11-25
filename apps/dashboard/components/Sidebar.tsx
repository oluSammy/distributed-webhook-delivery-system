"use client";

import classNames from "classnames";
import {
  ArchiveX,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Menu,
  Send,
  Settings,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Me } from "@/lib/api";

// How many endpoints there are, and how many deliveries wait in the dead-letter queue. null when
// they couldn't be read: the sidebar then shows no counts.
export type SidebarCounts = { endpoints: number; dead: number } | null;

type Count = { value: number; label: string; hot?: boolean };

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/endpoints", label: "Endpoints", icon: Webhook },
  { href: "/deliveries", label: "Deliveries", icon: Send },
  { href: "/events", label: "Events", icon: Zap },
  { href: "/dlq", label: "Dead-letter queue", icon: ArchiveX },
];

// The parts of the Settings page, each a section with this id.
const SETTINGS = [
  { id: "general", label: "General" },
  { id: "api-keys", label: "API keys" },
  { id: "event-types", label: "Event types" },
  { id: "delivery", label: "Delivery settings" },
  { id: "usage", label: "Usage & limits" },
];

// The cookie that remembers a collapsed sidebar. A cookie, not localStorage, so the server draws
// the sidebar the right width from the start (see app/(app)/layout.tsx).
export const COLLAPSED_COOKIE = "sidebar";

function isCurrent(href: string, pathname: string | null): boolean {
  if (pathname === null) {
    return false;
  }
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// The left-hand navigation. On a desktop it can collapse to icons; on a phone it's a bar with a
// menu button that opens the same contents as a drawer over the page.
export function Sidebar({
  me,
  counts = null,
  collapsed: startCollapsed = false,
}: {
  me: Me | null;
  counts?: SidebarCounts;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(startCollapsed);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    // A year, for every page. Expanding deletes it.
    // biome-ignore lint/suspicious/noDocumentCookie: one simple cookie; the Cookie Store API isn't in every browser
    document.cookie = next
      ? `${COLLAPSED_COOKIE}=collapsed; path=/; max-age=31536000; samesite=lax`
      : `${COLLAPSED_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  return (
    <nav
      aria-label="Main"
      className={classNames(
        "flex w-full flex-col gap-4 rounded-card border border-line bg-panel p-3.5 shadow-card md:sticky md:top-5 md:shrink-0",
        collapsed ? "md:w-[72px] md:px-2.5" : "md:w-[252px]",
      )}
    >
      <div className={classNames("flex items-center gap-2", collapsed && "md:flex-col")}>
        <Link
          href="/"
          aria-label={collapsed ? "Webhooks, Overview" : undefined}
          className="flex items-center gap-2.5 px-1.5 py-1 text-[17px] font-semibold"
        >
          <Webhook aria-hidden className="size-5 shrink-0 text-accent" />
          <span className={classNames(collapsed && "md:hidden")}>Webhooks</span>
        </Link>
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          className={classNames("hidden md:inline-flex", !collapsed && "ml-auto")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
        </Button>
        {me && (
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <Button iconOnly variant="ghost" className="ml-auto md:hidden" aria-label="Open menu">
                <Menu aria-hidden />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
              <Dialog.Content
                aria-describedby={undefined}
                className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] flex-col gap-4 overflow-y-auto border-r border-line-2 bg-panel p-3.5 shadow-card md:hidden"
              >
                <div className="flex items-center gap-2">
                  <Dialog.Title className="flex items-center gap-2.5 px-1.5 py-1 text-[17px] font-semibold">
                    <Webhook aria-hidden className="size-5 text-accent" />
                    Menu
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <Button iconOnly variant="ghost" className="ml-auto" aria-label="Close menu">
                      <X aria-hidden />
                    </Button>
                  </Dialog.Close>
                </div>
                <Contents me={me} counts={counts} compact={false} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>

      {/* On a desktop the contents sit in the sidebar; on a phone they're in the drawer above.
          This copy stays mounted on a phone too (only hidden), so it's the one that notices a
          new page and closes the drawer. */}
      <div className="hidden flex-col gap-4 md:flex">
        {me ? (
          <Contents
            me={me}
            counts={counts}
            compact={collapsed}
            onPageChange={() => setOpen(false)}
          />
        ) : (
          <>
            <Skeleton className="h-13 w-full rounded-inset" />
            <Links pathname={null} counts={null} compact={collapsed} />
            <Skeleton className="h-13.5 w-full rounded-inset" />
          </>
        )}
      </div>
    </nav>
  );
}

// The tenant switcher, the links and the account menu, for a signed-in person.
function Contents({
  me,
  counts,
  compact,
  onPageChange,
}: {
  me: Me;
  counts: SidebarCounts;
  compact: boolean;
  onPageChange?: () => void;
}) {
  const pathname = usePathname();

  // Close the phone's drawer once a link has taken you to another page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the page changes
  useEffect(() => onPageChange?.(), [pathname]);

  return (
    <>
      <TenantSwitcher me={me} compact={compact} />
      <Links pathname={pathname} counts={counts} compact={compact} />
      <AccountMenu me={me} compact={compact} />
    </>
  );
}

function Links({
  pathname,
  counts,
  compact,
}: {
  pathname: string | null;
  counts: SidebarCounts;
  compact: boolean;
}) {
  const countFor: Record<string, Count | undefined> = counts
    ? {
        "/endpoints": { value: counts.endpoints, label: "endpoints" },
        "/dlq": { value: counts.dead, label: "dead deliveries", hot: counts.dead > 0 },
      }
    : {};

  return (
    <>
      <div>
        <GroupTitle compact={compact}>Delivery</GroupTitle>
        <ul className="flex flex-col gap-0.5">
          {links.map(({ href, label, icon }) => (
            <li key={href}>
              <NavLink
                href={href}
                label={label}
                icon={icon}
                current={isCurrent(href, pathname)}
                count={countFor[href]}
                compact={compact}
              />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <GroupTitle compact={compact}>Account</GroupTitle>
        <ul className="flex flex-col gap-0.5">
          <li>
            {compact ? (
              <NavLink
                href="/settings"
                label="Settings"
                icon={Settings}
                current={isCurrent("/settings", pathname)}
                compact
              />
            ) : (
              <SettingsGroup current={isCurrent("/settings", pathname)} />
            )}
          </li>
        </ul>
      </div>
    </>
  );
}

function GroupTitle({ compact, children }: { compact: boolean; children: string }) {
  return (
    <p
      className={classNames(
        "mb-1.5 px-2 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase",
        compact && "sr-only",
      )}
    >
      {children}
    </p>
  );
}

const linkClass = "flex h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13.5px]";
const currentClass =
  "bg-[linear-gradient(90deg,var(--accent-soft),transparent)] text-fg shadow-[inset_0_0_0_1px_var(--accent-line)] [&>svg]:text-accent";
const otherClass = "text-fg-2 hover:bg-hover hover:text-fg";

function NavLink({
  href,
  label,
  icon: Icon,
  current,
  count,
  compact,
}: {
  href: string;
  label: string;
  icon: typeof Settings;
  current: boolean;
  count?: Count;
  compact: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      title={compact ? label : undefined}
      className={classNames(
        linkClass,
        compact && "justify-center px-0",
        current ? currentClass : otherClass,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={classNames(compact && "sr-only")}>{label}</span>
      {count && (
        <span
          className={classNames(
            "ml-auto flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] tabular-nums",
            count.hot ? "bg-dead-soft text-dead" : "bg-card-3 text-fg-2",
            compact && "sr-only",
          )}
        >
          <span aria-hidden>{count.value.toLocaleString("en")}</span>
          <span className="sr-only">
            , {count.value.toLocaleString("en")} {count.label}
          </span>
        </span>
      )}
    </Link>
  );
}

// Settings, with its sections underneath. Open while on the Settings page; a click opens or closes
// it anywhere.
function SettingsGroup({ current }: { current: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? current;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settings-sections"
        onClick={() => setToggled(!open)}
        className={classNames(
          linkClass,
          "cursor-pointer text-left",
          current ? "text-fg [&>svg:first-child]:text-accent" : otherClass,
        )}
      >
        <Settings aria-hidden className="size-4 shrink-0" />
        Settings
        <ChevronDown
          aria-hidden
          className={classNames(
            "ml-auto size-4 shrink-0 text-fg-3 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul id="settings-sections" className="mt-0.5 mb-1.5 ml-[18px] flex flex-col gap-0.5">
          {SETTINGS.map(({ id, label }) => (
            <li key={id}>
              <Link
                href={`/settings#${id}`}
                className="flex h-[34px] items-center rounded-[10px] px-2.5 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
