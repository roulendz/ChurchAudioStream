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
    <div className="channel-config-panel">
      <div className="channel-config-header">
        <button type="button" className="btn-back" onClick={onBack}>
          &larr; Back
        </button>
        <h3 className="channel-config-title">Configure: {channel.name}</h3>
      </div>

      <div className="channel-config-body">
        {/* Basic properties */}
        <div className="channel-config-section">
          <h4 className="config-section-title">Properties</h4>

          <div className="form-field">
            <label htmlFor="cfg-name">Channel Name</label>
            <input
              id="cfg-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="cfg-format">Output Format</label>
            <select
              id="cfg-format"
              value={editFormat}
              onChange={(e) =>
                setEditFormat(e.target.value as ChannelOutputFormat)
              }
            >
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
            </select>
          </div>

          <div className="form-field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={editAutoStart}
                onChange={(e) => setEditAutoStart(e.target.checked)}
              />
              Auto-start on server boot
            </label>
          </div>

          <div className="form-field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={editVisible}
                onChange={(e) => setEditVisible(e.target.checked)}
              />
              Visible to listeners
            </label>
          </div>

          {hasChanges && (
            <div className="channel-config-save">
              <button
                type="button"
                className="btn-primary"
                onClick={handleSave}
                disabled={!editName.trim()}
              >
                Save Changes
              </button>
            </div>
          )}
        </div>

        {/* Source assignment */}
        <div className="channel-config-section">
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
        </div>

        {/* Audio processing controls */}
        {sendMessage && (
          <div className="channel-config-section">
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
          </div>
        )}
      </div>
    </div>
  );
}
