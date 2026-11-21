"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "./Button";

// Copies value to the clipboard, then shows a tick for 2 s. With no children it's a small icon
// button, and label names it for screen readers ("Copy delivery id"); with children, like
// "Copy JSON", it's a small button with that text.
export function CopyButton({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // The browser refused (no permission, or the page isn't on https): nothing to show.
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <Button
      size="sm"
      variant={children ? "secondary" : "ghost"}
      iconOnly={!children}
      aria-label={children ? undefined : label}
      onClick={copy}
    >
      <Icon aria-hidden />
      {children}
      {/* Read out by screen readers when it changes. */}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
