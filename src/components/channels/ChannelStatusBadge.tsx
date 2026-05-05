import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ChannelStatus } from "@/hooks/useChannels";

const STATUS_CONFIG: Record<
  ChannelStatus,
  { label: string; className: string }
> = {
  streaming: {
    label: "Streaming",
    className: "bg-success/20 text-success border-success/30",
  },
  starting: {
    label: "Starting",
    className: "bg-warning/20 text-warning border-warning/30",
  },
  stopped: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground border-border",
  },
  error: {
    label: "Error",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
  crashed: {
    label: "Crashed",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
};

export function ChannelStatusBadge({ status }: { status: ChannelStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge
      variant="outline"
      className={cn("text-[0.65rem] uppercase tracking-wide", config.className)}
    >
      {config.label}
    </Badge>
  );
}
