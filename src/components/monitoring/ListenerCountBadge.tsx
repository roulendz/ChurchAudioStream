import { cn } from "@/lib/utils";

interface ListenerCountBadgeProps {
  count: number;
  label?: string;
}

export function ListenerCountBadge({
  count,
  label,
}: ListenerCountBadgeProps) {
  const isEmpty = count === 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-sm text-foreground",
        isEmpty && "text-muted-foreground"
      )}
    >
      <svg
        className="inline-flex items-center"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
      <span>{count}</span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
}
