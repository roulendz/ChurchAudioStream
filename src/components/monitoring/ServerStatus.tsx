import { cn } from "@/lib/utils";
import type { ResourceStats, WorkerInfo } from "../../hooks/useResourceStats";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChannelInfo {
  id: string;
  name: string;
}

interface ServerStatusProps {
  stats: ResourceStats | null;
  totalListeners: number;
  workers: WorkerInfo[];
  channels: ChannelInfo[];
  getChannelListenerCount: (channelId: string) => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatMemoryKb(kb: number): string {
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ServerStatus({
  stats,
  totalListeners,
  workers,
  channels,
  getChannelListenerCount,
}: ServerStatusProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <div className="text-xs text-muted-foreground mb-1">Server Status</div>
          <div className="text-2xl font-semibold text-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {/* Total Visitors + per-channel breakdown */}
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground mb-1">Total Visitors</div>
        <div className="text-3xl font-semibold text-foreground">
          {totalListeners}
        </div>
        {channels.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-1.5 bg-secondary rounded-md px-2 py-1">
                <span className="text-xs text-muted-foreground">{ch.name}</span>
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
                  {getChannelListenerCount(ch.id)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Uptime */}
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground mb-1">Uptime</div>
        <div className="text-2xl font-semibold text-foreground">{formatUptime(stats.uptime)}</div>
      </div>

      {/* Host:Port */}
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground mb-1">Server Address</div>
        <div className="text-base font-semibold text-foreground font-[family-name:var(--font-mono)]">
          {stats.config.host}:{stats.config.port}
        </div>
      </div>

      {/* Connections */}
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground mb-1">Connections</div>
        <div className="text-2xl font-semibold text-foreground">{stats.connections.total}</div>
        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
          <span>Admin: {stats.connections.admin}</span>
          <span>Listener: {stats.connections.listener}</span>
          {stats.connections.unidentified > 0 && (
            <span>Other: {stats.connections.unidentified}</span>
          )}
        </div>
      </div>

      {/* Workers */}
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground mb-1">
          mediasoup Workers ({workers.length})
        </div>
        {workers.length === 0 ? (
          <div className="text-base font-semibold text-foreground font-[family-name:var(--font-mono)]">
            No workers
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {workers.map((worker) => (
              <div key={worker.index} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "size-2 rounded-full shrink-0",
                    worker.alive ? "bg-success" : "bg-destructive"
                  )}
                />
                <span>
                  Worker {worker.index}: {formatMemoryKb(worker.peakMemoryKb)},{" "}
                  {worker.routerCount} router
                  {worker.routerCount !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
