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
    <div className="grid grid-cols-[220px_1fr] grid-rows-[auto_1fr] min-h-screen">
      <header className="col-span-full flex items-center justify-between px-5 py-3 border-b border-border bg-background sticky top-0 z-50">
        <h1 className="text-xl font-semibold text-foreground">Church Audio Stream - Admin</h1>
        <ConnectionStatus
          status={connectionStatus}
          reconnectAttempts={reconnectAttempts}
        />
      </header>

      <Sidebar currentSection={currentSection} onNavigate={onNavigate} />

      <main className="row-start-2 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
