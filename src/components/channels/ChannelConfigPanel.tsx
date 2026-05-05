import { useState, useEffect } from "react";
import type {
  AdminChannel,
  ChannelOutputFormat,
} from "../../hooks/useChannels";
import type { DiscoveredSource } from "../../hooks/useSources";
import { SourceSelector } from "./SourceSelector";
import { ProcessingControls } from "./ProcessingControls";

interface ChannelConfigPanelProps {
  channel: AdminChannel;
  sources: DiscoveredSource[];
  onUpdate: (
    channelId: string,
    updates: {
      name?: string;
      outputFormat?: ChannelOutputFormat;
      autoStart?: boolean;
      visible?: boolean;
    },
  ) => void;
  onAddSource: (
    channelId: string,
    sourceId: string,
    selectedChannels: number[],
  ) => void;
  onRemoveSource: (channelId: string, sourceIndex: number) => void;
  onBack: () => void;
  sendMessage?: (type: string, payload?: unknown) => void;
}

export function ChannelConfigPanel({
  channel,
  sources,
  onUpdate,
  onAddSource,
  onRemoveSource,
  onBack,
  sendMessage,
}: ChannelConfigPanelProps) {
  const [editName, setEditName] = useState(channel.name);
  const [editFormat, setEditFormat] = useState<ChannelOutputFormat>(
    channel.outputFormat,
  );
  const [editAutoStart, setEditAutoStart] = useState(channel.autoStart);
  const [editVisible, setEditVisible] = useState(channel.visible);

  // Sync local state when channel prop changes (server broadcast)
  useEffect(() => {
    setEditName(channel.name);
    setEditFormat(channel.outputFormat);
    setEditAutoStart(channel.autoStart);
    setEditVisible(channel.visible);
  }, [channel.name, channel.outputFormat, channel.autoStart, channel.visible]);

  const hasChanges =
    editName !== channel.name ||
    editFormat !== channel.outputFormat ||
    editAutoStart !== channel.autoStart ||
    editVisible !== channel.visible;

  function handleSave() {
    const updates: Record<string, unknown> = {};
    if (editName !== channel.name) updates.name = editName.trim();
    if (editFormat !== channel.outputFormat) updates.outputFormat = editFormat;
    if (editAutoStart !== channel.autoStart)
      updates.autoStart = editAutoStart;
    if (editVisible !== channel.visible) updates.visible = editVisible;

    if (Object.keys(updates).length > 0) {
      onUpdate(channel.id, updates as Parameters<typeof onUpdate>[1]);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="bg-transparent border border-border rounded-md text-muted-foreground px-3 py-1.5 text-sm cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <h3 className="text-base font-semibold text-foreground">Configure: {channel.name}</h3>
      </div>

      <div className="flex flex-col gap-6">
        {/* Basic properties */}
        <section className="bg-card border border-border rounded-md p-5 flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-foreground mb-1">Properties</h4>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfg-name" className="text-sm font-medium text-muted-foreground">
              Channel Name
            </label>
            <input
              id="cfg-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfg-format" className="text-sm font-medium text-muted-foreground">
              Output Format
            </label>
            <select
              id="cfg-format"
              value={editFormat}
              onChange={(e) =>
                setEditFormat(e.target.value as ChannelOutputFormat)
              }
              className="px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring"
            >
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={editAutoStart}
              onChange={(e) => setEditAutoStart(e.target.checked)}
              className="accent-primary"
            />
            Auto-start on server boot
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={editVisible}
              onChange={(e) => setEditVisible(e.target.checked)}
              className="accent-primary"
            />
            Visible to listeners
          </label>

          {hasChanges && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
                onClick={handleSave}
                disabled={!editName.trim()}
              >
                Save Changes
              </button>
            </div>
          )}
        </section>

        {/* Source assignment */}
        <section className="bg-card border border-border rounded-md p-5 flex flex-col gap-3">
          <SourceSelector
            sources={sources}
            assignedSources={channel.sources}
            onAddSource={(sourceId, selectedChannels) =>
              onAddSource(channel.id, sourceId, selectedChannels)
            }
            onRemoveSource={(sourceIndex) =>
              onRemoveSource(channel.id, sourceIndex)
            }
          />
        </section>

        {/* Audio processing controls */}
        {sendMessage && (
          <section className="bg-card border border-border rounded-md p-5 flex flex-col gap-3">
            <ProcessingControls
              channelId={channel.id}
              processing={{
                mode: (channel.processing as Record<string, unknown>).mode as string ?? "speech",
                agc: {
                  enabled: ((channel.processing as Record<string, unknown>).agc as Record<string, unknown>)?.enabled as boolean ?? true,
                  targetLufs: ((channel.processing as Record<string, unknown>).agc as Record<string, unknown>)?.targetLufs as number ?? -16,
                },
              }}
              sendMessage={sendMessage}
            />
          </section>
        )}
      </div>
    </div>
  );
}
