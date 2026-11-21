"use client";

import { ToggleGroup } from "radix-ui";

// A row of options where exactly one is chosen, like the time range "1 h | 24 h | 7 d".
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onChange(next as Value)}
      className="inline-flex rounded-full border border-line-2 bg-card p-[3px]"
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={
            "h-8 min-w-[46px] cursor-pointer rounded-full px-3 text-[13px] text-fg-2 " +
            "data-[state=on]:bg-accent-soft data-[state=on]:text-fg " +
            "data-[state=on]:shadow-[inset_0_0_0_1px_var(--accent-line)]"
          }
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
