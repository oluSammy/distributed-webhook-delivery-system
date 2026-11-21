"use client";

import classNames from "classnames";
import {
  ArchiveX,
  Bell,
  LayoutDashboard,
  Menu,
  ScrollText,
  Send,
  Settings,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const groups = [
  {
    title: "Delivery",
    links: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/endpoints", label: "Endpoints", icon: Webhook },
      { href: "/deliveries", label: "Deliveries", icon: Send },
      { href: "/events", label: "Events", icon: Zap },
      { href: "/dlq", label: "Dead-letter queue", icon: ArchiveX },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/audit", label: "Audit log", icon: ScrollText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function isCurrent(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the folded menu once a link has taken you to another page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the page changes
  useEffect(() => setOpen(false), [pathname]);

  return (
    <nav
      aria-label="Main"
      className="flex w-full flex-col gap-4 rounded-card border border-line bg-panel p-3.5 shadow-card md:sticky md:top-5 md:w-[252px] md:shrink-0"
    >
      <div className="flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2.5 px-1.5 py-1 text-[17px] font-semibold">
          <Webhook aria-hidden className="size-5 text-accent" />
          Webhooks
        </Link>
        <Button
          iconOnly
          variant="ghost"
          className="ml-auto md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="main-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
      </div>

      <div
        id="main-menu"
        className={classNames("flex-col gap-4 md:flex", open ? "flex" : "hidden")}
      >
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 px-2 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.links.map(({ href, label, icon: Icon }) => {
                const current = isCurrent(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className={classNames(
                        "flex h-[38px] items-center gap-2.5 rounded-xl px-2.5 text-[13.5px]",
                        current
                          ? "bg-[linear-gradient(90deg,var(--accent-soft),transparent)] text-fg shadow-[inset_0_0_0_1px_var(--accent-line)] [&>svg]:text-accent"
                          : "text-fg-2 hover:bg-hover hover:text-fg",
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
