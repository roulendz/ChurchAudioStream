import type { ConnectionStatus as ConnectionStatusType } from "../hooks/useWebSocket";

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  reconnectAttempts: number;
}

const STATUS_DISPLAY: Record<
  ConnectionStatusType,
  { label: string; className: string }
> = {
  connected: { label: "Connected", className: "status-dot--connected" },
  connecting: { label: "Connecting...", className: "status-dot--connecting" },
  reconnecting: {
    label: "Reconnecting",
    className: "status-dot--reconnecting",
  },
  disconnected: {
    label: "Disconnected",
    className: "status-dot--disconnected",
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
    <div className="connection-status" role="status" aria-live="polite">
      <span className={`status-dot ${className}`} aria-hidden="true" />
      <span className="status-label">{displayLabel}</span>
    </div>
  );
}
