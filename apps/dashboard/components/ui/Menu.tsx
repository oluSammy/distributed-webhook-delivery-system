import { Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

const item =
  "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] outline-none select-none data-[highlighted]:bg-hover [&_svg]:size-4";

export function MenuContent({ children, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={6}
        className="z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-inset border border-line-2 bg-card p-1.5 shadow-card"
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem(props: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={item} {...props} />;
}

// One of a set where one is chosen (like the current tenant), with a tick on the chosen one.
export function MenuRadioItem({
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={item} {...props}>
      <span className="flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check aria-hidden className="text-accent" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1.5 h-px bg-line" />;
}
