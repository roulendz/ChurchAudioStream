import { useState } from "react";
import "./App.css";
import { useServerStatus } from "./hooks/useServerStatus";
import { useChannels } from "./hooks/useChannels";
import { useSources } from "./hooks/useSources";
import { useAudioLevels } from "./hooks/useAudioLevels";
import { useListenerCounts } from "./hooks/useListenerCounts";
import { useResourceStats } from "./hooks/useResourceStats";
import { DashboardShell } from "./components/layout/DashboardShell";
import type { DashboardSection } from "./components/layout/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { LogViewer } from "./components/LogViewer";
import { ChannelList } from "./components/channels/ChannelList";
import { ChannelCreateDialog } from "./components/channels/ChannelCreateDialog";
import { ChannelConfigPanel } from "./components/channels/ChannelConfigPanel";
import { VuMeterBank } from "./components/monitoring/VuMeterBank";
import { ServerStatus } from "./components/monitoring/ServerStatus";
import { QrCodeDisplay } from "./components/settings/QrCodeDisplay";

function App() {
  const [currentSection, setCurrentSection] = useState<DashboardSection>("overview");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const {
    config,
    connectionStatus,
    reconnectAttempts,
    interfaces,
    updateConfig,
    sendMessage,
    subscribe,
  } = useServerStatus();

  const {
    channels,
    createChannel,
    updateChannel,
    removeChannel,
    startChannel,
    stopChannel,
    reorderChannels,
    addSource,
    removeSource,
  } = useChannels(sendMessage, subscribe);

  const { sources } = useSources(sendMessage, subscribe);
  const audioLevels = useAudioLevels(subscribe);
  const { totalListeners, getChannelListenerCount } = useListenerCounts(sendMessage, subscribe);
  const { stats, workers } = useResourceStats(sendMessage, subscribe);

  const selectedChannel = selectedChannelId
    ? channels.find((ch) => ch.id === selectedChannelId) ?? null
    : null;

  return (
    <DashboardShell
      currentSection={currentSection}
      onNavigate={setCurrentSection}
      connectionStatus={connectionStatus}
      reconnectAttempts={reconnectAttempts}
    >
      {currentSection === "overview" && (
        <div className="overview-section">
          <h2>Overview</h2>
          <ServerStatus
            stats={stats}
            totalListeners={totalListeners}
            workers={workers}
          />
          <QrCodeDisplay config={config} />
          {channels.length > 0 && (
            <div className="overview-channel-badges">
              <h3 className="overview-subheading">Listeners per Channel</h3>
              <div className="overview-badge-grid">
                {channels.map((ch) => (
                  <div key={ch.id} className="overview-badge-item">
                    <span className="overview-badge-name">{ch.name}</span>
                    <span className="listener-badge">
                      <span className="listener-badge-count">
                        {getChannelListenerCount(ch.id)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {currentSection === "channels" && (
        <>
          {selectedChannel ? (
            <ChannelConfigPanel
              channel={selectedChannel}
              sources={sources}
              onUpdate={updateChannel}
              onAddSource={addSource}
              onRemoveSource={removeSource}
              onBack={() => setSelectedChannelId(null)}
              sendMessage={sendMessage}
            />
          ) : showCreateDialog ? (
            <ChannelCreateDialog
              onCreate={(name, outputFormat) => {
                createChannel(name, outputFormat);
                setShowCreateDialog(false);
              }}
              onCancel={() => setShowCreateDialog(false)}
            />
          ) : (
            <ChannelList
              channels={channels}
              onStartChannel={startChannel}
              onStopChannel={stopChannel}
              onRemoveChannel={removeChannel}
              onConfigureChannel={setSelectedChannelId}
              onReorderChannels={reorderChannels}
              onCreateClick={() => setShowCreateDialog(true)}
            />
          )}
        </>
      )}

      {currentSection === "monitoring" && (
        <div className="monitoring-section">
          <h2 className="monitoring-section-title">Audio Levels</h2>
          <VuMeterBank channels={channels} audioLevels={audioLevels} />
        </div>
      )}

      {currentSection === "settings" && (
        <>
          <SettingsPanel
            config={config}
            interfaces={interfaces}
            onSave={updateConfig}
          />
          <div className="settings-qr-code">
            <QrCodeDisplay config={config} />
          </div>
          <div className="settings-log-viewer">
            <LogViewer subscribe={subscribe} />
          </div>
        </>
      )}
    </DashboardShell>
  );
}

export default App;
