import type { AdminChannel } from "../../hooks/useChannels";

interface ChannelListProps {
  channels: AdminChannel[];
  onStartChannel: (channelId: string) => void;
  onStopChannel: (channelId: string) => void;
  onRemoveChannel: (channelId: string) => void;
  onConfigureChannel: (channelId: string) => void;
  onReorderChannels: (channelIds: string[]) => void;
  onCreateClick: () => void;
}

/** Map channel status to a CSS modifier class. */
function statusModifier(status: string): string {
  switch (status) {
    case "streaming":
      return "channel-status--streaming";
    case "starting":
      return "channel-status--starting";
    case "error":
    case "crashed":
      return "channel-status--error";
    default:
      return "channel-status--stopped";
  }
}

export function ChannelList({
  channels,
  onStartChannel,
  onStopChannel,
  onRemoveChannel,
  onConfigureChannel,
  onReorderChannels,
  onCreateClick,
}: ChannelListProps) {
  function handleMoveUp(index: number) {
    if (index === 0) return;
    const ids = channels.map((ch) => ch.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    onReorderChannels(ids);
  }

  function handleMoveDown(index: number) {
    if (index === channels.length - 1) return;
    const ids = channels.map((ch) => ch.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    onReorderChannels(ids);
  }

  const isRunning = (status: string) =>
    status === "streaming" || status === "starting";

  return (
    <div className="channel-list">
      <div className="channel-list-header">
        <h3 className="channel-list-title">Channels</h3>
        <button
          type="button"
          className="btn-primary"
          onClick={onCreateClick}
        >
          + New Channel
        </button>
      </div>

      {channels.length === 0 && (
        <p className="channel-list-empty">
          No channels yet. Create one to get started.
        </p>
      )}

      <ul className="channel-cards">
        {channels.map((channel, index) => (
          <li key={channel.id} className="channel-card">
            <div className="channel-card-main">
              <div className="channel-card-info">
                <span className="channel-card-name">{channel.name}</span>
                <span
                  className={`channel-status-badge ${statusModifier(channel.status)}`}
                >
                  {channel.status}
                </span>
                {!channel.visible && (
                  <span className="channel-hidden-badge" title="Hidden from listeners">
                    Hidden
                  </span>
                )}
              </div>
              <div className="channel-card-meta">
                <span className="channel-meta-format">{channel.outputFormat}</span>
                <span className="channel-meta-sources">
                  {channel.sources.length} source{channel.sources.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            <div className="channel-card-actions">
              {/* Reorder buttons */}
              <button
                type="button"
                className="btn-icon"
                disabled={index === 0}
                onClick={() => handleMoveUp(index)}
                title="Move up"
              >
                &#9650;
              </button>
              <button
                type="button"
                className="btn-icon"
                disabled={index === channels.length - 1}
                onClick={() => handleMoveDown(index)}
                title="Move down"
              >
                &#9660;
              </button>

              {/* Start / Stop toggle */}
              {isRunning(channel.status) ? (
                <button
                  type="button"
                  className="btn-secondary btn-stop"
                  onClick={() => onStopChannel(channel.id)}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary btn-start"
                  onClick={() => onStartChannel(channel.id)}
                >
                  Start
                </button>
              )}

              {/* Configure */}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onConfigureChannel(channel.id)}
              >
                Configure
              </button>

              {/* Remove */}
              <button
                type="button"
                className="btn-icon btn-remove-channel"
                onClick={() => onRemoveChannel(channel.id)}
                title="Remove channel"
              >
                X
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
