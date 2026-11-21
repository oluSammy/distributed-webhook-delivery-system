import { Tabs as RadixTabs } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

export const Tabs = RadixTabs.Root;

export function TabList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTabs.List
      aria-label={label}
      className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--line)]"
    >
      {children}
    </RadixTabs.List>
  );
}

export function Tab(props: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={
        "h-[42px] cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3.5 " +
        "text-[13.5px] text-fg-2 hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
      }
      {...props}
    />
  );
}

export function TabPanel(props: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className="pt-4" {...props} />;
}
