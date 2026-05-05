import { cn } from "@/lib/utils";
import type { ConnectionStatus as ConnectionStatusType } from "../hooks/useWebSocket";

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  reconnectAttempts: number;
}

const STATUS_DISPLAY: Record<
  ConnectionStatusType,
  { label: string; className: string }
> = {
  connected: { label: "Connected", className: "bg-success shadow-[0_0_6px] shadow-success" },
  connecting: { label: "Connecting...", className: "bg-warning animate-pulse" },
  reconnecting: {
    label: "Reconnecting",
    className: "bg-warning animate-pulse",
  },
  disconnected: {
    label: "Disconnected",
    className: "bg-destructive",
  },
};

export function ConnectionStatus({
  status,
  reconnectAttempts,
}: ConnectionStatusProps) {
  const { label, className } = STATUS_DISPLAY[status];
  const displayLabel =
    status === "reconnecting" && reconnectAttempts > 0
      ? `${label} (attempt ${reconnectAttempts})...`
      : label;

  return (
    <div className="flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-card" role="status" aria-live="polite">
      <span className={cn("size-2 rounded-full shrink-0", className)} aria-hidden="true" />
      <span className="text-muted-foreground whitespace-nowrap">{displayLabel}</span>
    </div>
  );
}
