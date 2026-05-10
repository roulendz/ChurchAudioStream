import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus as ConnectionStatusType } from "../hooks/useWebSocket";

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  reconnectAttempts: number;
}

const STATUS_DISPLAY: Record<
  ConnectionStatusType,
  { label: string; dotClassName: string }
> = {
  connected: {
    label: "Connected",
    dotClassName: "bg-success animate-pulse shadow-[0_0_6px] shadow-success",
  },
  connecting: {
    label: "Connecting...",
    dotClassName: "bg-warning animate-pulse",
  },
  reconnecting: {
    label: "Reconnecting",
    dotClassName: "bg-warning animate-pulse",
  },
  disconnected: {
    label: "Disconnected",
    dotClassName: "bg-destructive",
  },
};

export function ConnectionStatus({
  status,
  reconnectAttempts,
}: ConnectionStatusProps) {
  const { label, dotClassName } = STATUS_DISPLAY[status];
  const displayLabel =
    status === "reconnecting" && reconnectAttempts > 0
      ? `${label} (attempt ${reconnectAttempts})...`
      : label;

  return (
    <Badge
      variant="outline"
      className="gap-1.5"
      role="status"
      aria-live="polite"
    >
      <span
        className={cn("size-2 rounded-full shrink-0", dotClassName)}
        aria-hidden="true"
      />
      <span className="text-muted-foreground whitespace-nowrap">
        {displayLabel}
      </span>
    </Badge>
  );
}
