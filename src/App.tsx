import { useState } from "react";
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
import { UpdateToast } from "./components/UpdateToast";
import { CheckForUpdatesButton } from "./components/CheckForUpdatesButton";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    <>
    <UpdateToast />
    <TooltipProvider>
    <DashboardShell
      currentSection={currentSection}
      onNavigate={setCurrentSection}
      connectionStatus={connectionStatus}
      reconnectAttempts={reconnectAttempts}
      totalListeners={totalListeners}
    >
      {currentSection === "overview" && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Overview</h2>
          <ServerStatus
            stats={stats}
            totalListeners={totalListeners}
            workers={workers}
          />
          <QrCodeDisplay config={config} />
          {channels.length > 0 && (
            <div className="bg-card border border-border rounded-md p-5">
              <h3 className="text-base font-semibold text-foreground mb-3">Listeners per Channel</h3>
              <div className="flex flex-wrap gap-3">
                {channels.map((ch) => (
                  <div key={ch.id} className="flex items-center gap-2 bg-secondary rounded-md px-3 py-2">
                    <span className="text-sm text-muted-foreground">{ch.name}</span>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                      {getChannelListenerCount(ch.id)}
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
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Audio Levels</h2>
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
          <div className="mt-6">
            <CheckForUpdatesButton />
          </div>
          <div className="mt-6">
            <QrCodeDisplay config={config} />
          </div>
          <div className="mt-6">
            <LogViewer subscribe={subscribe} />
          </div>
        </>
      )}
    </DashboardShell>
    </TooltipProvider>
    </>
  );
}

export default App;
