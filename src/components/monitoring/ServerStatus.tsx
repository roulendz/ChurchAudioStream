import type { ResourceStats, WorkerInfo } from "../../hooks/useResourceStats";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ServerStatusProps {
  stats: ResourceStats | null;
  totalListeners: number;
  workers: WorkerInfo[];
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
}: ServerStatusProps) {
  if (!stats) {
    return (
      <div className="server-status">
        <div className="stat-card">
          <div className="stat-card-label">Server Status</div>
          <div className="stat-card-value">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="server-status">
      {/* Total Listeners */}
      <div className="stat-card">
        <div className="stat-card-label">Total Listeners</div>
        <div className="stat-card-value stat-card-value--large">
          {totalListeners}
        </div>
      </div>

      {/* Uptime */}
      <div className="stat-card">
        <div className="stat-card-label">Uptime</div>
        <div className="stat-card-value">{formatUptime(stats.uptime)}</div>
      </div>

      {/* Host:Port */}
      <div className="stat-card">
        <div className="stat-card-label">Server Address</div>
        <div className="stat-card-value stat-card-value--small">
          {stats.config.host}:{stats.config.port}
        </div>
      </div>

      {/* Connections */}
      <div className="stat-card">
        <div className="stat-card-label">Connections</div>
        <div className="stat-card-value">{stats.connections.total}</div>
        <div className="stat-card-breakdown">
          <span>Admin: {stats.connections.admin}</span>
          <span>Listener: {stats.connections.listener}</span>
          {stats.connections.unidentified > 0 && (
            <span>Other: {stats.connections.unidentified}</span>
          )}
        </div>
      </div>

      {/* Workers */}
      <div className="stat-card">
        <div className="stat-card-label">
          mediasoup Workers ({workers.length})
        </div>
        {workers.length === 0 ? (
          <div className="stat-card-value stat-card-value--small">
            No workers
          </div>
        ) : (
          <div className="worker-list">
            {workers.map((worker) => (
              <div key={worker.index} className="worker-item">
                <span
                  className={`worker-dot ${worker.alive ? "worker-dot--alive" : "worker-dot--dead"}`}
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
