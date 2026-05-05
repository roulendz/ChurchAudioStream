import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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
    <Badge
      variant="secondary"
      className={cn("gap-1", isEmpty && "text-muted-foreground")}
    >
      <Users className="size-3.5" />
      <span>{count}</span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </Badge>
  );
}
