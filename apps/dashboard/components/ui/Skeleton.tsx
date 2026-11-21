import classNames from "classnames";

// A grey shape that shimmers while data loads, sized like what will replace it:
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={classNames(
        "animate-skeleton rounded-lg bg-[linear-gradient(90deg,var(--card-2),var(--card-3),var(--card-2))] bg-[length:200%_100%] motion-reduce:animate-none",
        className,
      )}
    />
  );
}
