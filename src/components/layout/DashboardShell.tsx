import { useState } from "react";
import type { ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import type { ConnectionStatus as ConnectionStatusType } from "../../hooks/useWebSocket";
import { ConnectionStatus } from "../ConnectionStatus";
import { ListenerCountBadge } from "../monitoring/ListenerCountBadge";
import { Sidebar, type DashboardSection } from "./Sidebar";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  currentSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  connectionStatus: ConnectionStatusType;
  reconnectAttempts: number;
  totalListeners: number;
  children: ReactNode;
}

const SECTION_LABELS: Record<DashboardSection, string> = {
  overview: "Overview",
  channels: "Channels",
  monitoring: "Monitoring",
  settings: "Settings",
};

export function DashboardShell({
  currentSection,
  onNavigate,
  connectionStatus,
  reconnectAttempts,
  totalListeners,
  children,
}: DashboardShellProps) {
  const [sidebarVisible, setSidebarVisible] = useState(true);

  return (
    <div
      className={cn(
        "grid grid-rows-[auto_1fr] min-h-screen",
        sidebarVisible ? "grid-cols-[220px_1fr]" : "grid-cols-[1fr]"
      )}
    >
      <header className="col-span-full flex items-center justify-between px-5 py-3 border-b border-border bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarVisible((prev) => !prev)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-5" />
          </Button>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <span className="text-muted-foreground text-sm">Admin</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{SECTION_LABELS[currentSection]}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-3">
          <ListenerCountBadge count={totalListeners} />
          <ConnectionStatus
            status={connectionStatus}
            reconnectAttempts={reconnectAttempts}
          />
        </div>
      </header>

      {sidebarVisible && (
        <Sidebar currentSection={currentSection} onNavigate={onNavigate} />
      )}

      <main className="row-start-2 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
