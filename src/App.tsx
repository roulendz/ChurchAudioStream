import "./App.css";
import { useServerStatus } from "./hooks/useServerStatus";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SettingsPanel } from "./components/SettingsPanel";
import { LogViewer } from "./components/LogViewer";

function App() {
  const {
    config,
    connectionStatus,
    reconnectAttempts,
    interfaces,
    updateConfig,
    subscribe,
  } = useServerStatus();

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">Church Audio Stream - Admin</h1>
        <ConnectionStatus
          status={connectionStatus}
          reconnectAttempts={reconnectAttempts}
        />
      </header>

      <main className="app-content">
        <SettingsPanel
          config={config}
          interfaces={interfaces}
          onSave={updateConfig}
        />
      </main>

      <footer className="app-footer">
        <LogViewer subscribe={subscribe} />
      </footer>
    </div>
  );
}

export default App;
