import type { ReactNode } from "react";
import type { ConnectionStatus as ConnectionStatusType } from "../../hooks/useWebSocket";
import { ConnectionStatus } from "../ConnectionStatus";
import { Sidebar, type DashboardSection } from "./Sidebar";

interface DashboardShellProps {
  currentSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  connectionStatus: ConnectionStatusType;
  reconnectAttempts: number;
  children: ReactNode;
}

export function DashboardShell({
  currentSection,
  onNavigate,
  connectionStatus,
  reconnectAttempts,
  children,
}: DashboardShellProps) {
  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <h1 className="app-title">Church Audio Stream - Admin</h1>
        <ConnectionStatus
          status={connectionStatus}
          reconnectAttempts={reconnectAttempts}
        />
      </header>

      <Sidebar currentSection={currentSection} onNavigate={onNavigate} />

      <main className="dashboard-content">{children}</main>
    </div>
  );
}
