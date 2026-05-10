import { useState, useEffect, useRef } from "react";
import { BUILD_VERSION } from "../lib/version";

interface ServerStatus {
  instanceId?: string;
  uptime?: number;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function fetchServerStatus(): Promise<ServerStatus | null> {
  return fetch("/api/status", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<ServerStatus>) : null))
    .catch(() => null);
}

export function VersionFooter() {
  const [elapsed, setElapsed] = useState("--");
  const [instanceId, setInstanceId] = useState<string | null>(
    () => sessionStorage.getItem("cas_instance_id")
  );
  const serverStartedAt = useRef<number | null>(null);

  useEffect(() => {
    fetchServerStatus().then((data) => {
      if (!data) return;
      if (typeof data.instanceId === "string") {
        sessionStorage.setItem("cas_instance_id", data.instanceId);
        setInstanceId(data.instanceId);
      }
      if (typeof data.uptime === "number") {
        serverStartedAt.current = Date.now() - data.uptime * 1000;
        setElapsed(formatElapsed(data.uptime * 1000));
      }
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (serverStartedAt.current === null) return;
      setElapsed(formatElapsed(Date.now() - serverStartedAt.current));
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="version-footer" title={`Version ${BUILD_VERSION}${instanceId ? ` · Launch ID: ${instanceId}` : ""} · Server uptime: ${elapsed} · Changes when server restarts — phones auto-detect and reload`}>
      <span className="version-footer__version">
        v{BUILD_VERSION}
        {instanceId && <span className="version-footer__hash">-{instanceId.slice(0, 6)}</span>}
      </span>
      <span className="version-footer__separator" aria-hidden="true" />
      <span className="version-footer__uptime">{elapsed}</span>
    </div>
  );
}
