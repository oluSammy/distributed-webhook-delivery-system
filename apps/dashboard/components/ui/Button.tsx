import classNames from "classnames";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

const variants = {
  secondary: "border-line-2 bg-card-2 text-fg hover:bg-card-3",
  primary: "border-transparent bg-accent text-accent-ink hover:bg-accent-2",
  ghost: "border-transparent bg-transparent text-fg-2 hover:bg-hover hover:text-fg",
  danger: "border-dead/40 bg-dead-soft text-dead hover:bg-dead/20",
};

const sizes = {
  sm: "min-h-[30px] px-2.5 text-[12.5px]",
  md: "min-h-9 px-3.5 text-[13.5px]",
  lg: "min-h-11 px-5 text-sm",
};

// Square buttons that hold only an icon. They need an aria-label, so screen readers can name them.
const iconOnlySizes = { sm: "size-[30px]", md: "size-10", lg: "size-11" };

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  iconOnly?: boolean;
  // Style the one child element as the button instead, like a link: <Button asChild><a href=…>
  asChild?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      type={asChild ? undefined : (type ?? "button")}
      className={classNames(
        "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium",
        "disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        iconOnly ? iconOnlySizes[size] : sizes[size],
        className,
      )}
      {...props}
    />
  );
}
