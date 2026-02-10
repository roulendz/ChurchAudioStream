import { useState } from "react";
import "./App.css";
import { useServerStatus } from "./hooks/useServerStatus";
import { DashboardShell } from "./components/layout/DashboardShell";
import type { DashboardSection } from "./components/layout/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { LogViewer } from "./components/LogViewer";

function App() {
  const [currentSection, setCurrentSection] = useState<DashboardSection>("overview");

  const {
    config,
    connectionStatus,
    reconnectAttempts,
    interfaces,
    updateConfig,
    subscribe,
  } = useServerStatus();

  return (
    <DashboardShell
      currentSection={currentSection}
      onNavigate={setCurrentSection}
      connectionStatus={connectionStatus}
      reconnectAttempts={reconnectAttempts}
    >
      {currentSection === "overview" && (
        <div className="section-placeholder">
          <h2>Overview</h2>
          <p>Overview coming soon</p>
        </div>
      )}

      {currentSection === "channels" && (
        <div className="section-placeholder">
          <h2>Channels</h2>
          <p>Channel configuration coming soon</p>
        </div>
      )}

      {currentSection === "monitoring" && (
        <div className="section-placeholder">
          <h2>Monitoring</h2>
          <p>Monitoring coming soon</p>
        </div>
      )}

      {currentSection === "settings" && (
        <>
          <SettingsPanel
            config={config}
            interfaces={interfaces}
            onSave={updateConfig}
          />
          <div className="settings-log-viewer">
            <LogViewer subscribe={subscribe} />
          </div>
        </>
      )}
    </DashboardShell>
  );
}

export default App;
