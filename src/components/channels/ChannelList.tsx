import { cn } from "@/lib/utils";
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

/** Map channel status to Tailwind badge classes. */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "streaming":
      return "bg-success/20 text-success";
    case "starting":
      return "bg-warning/20 text-warning";
    case "error":
    case "crashed":
      return "bg-destructive/20 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Channels</h3>
        <button
          type="button"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
          onClick={onCreateClick}
        >
          + New Channel
        </button>
      </div>

      {channels.length === 0 && (
        <p className="text-muted-foreground italic py-8 text-center">
          No channels yet. Create one to get started.
        </p>
      )}

      <ul className="list-none flex flex-col gap-2">
        {channels.map((channel, index) => (
          <li
            key={channel.id}
            className="flex items-center justify-between gap-4 px-4 py-3 bg-secondary border border-border rounded-md transition-colors hover:border-muted-foreground"
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[0.95rem] text-foreground">{channel.name}</span>
                <span
                  className={cn(
                    "text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-full tracking-wide",
                    statusBadgeClass(channel.status),
                  )}
                >
                  {channel.status}
                </span>
                {!channel.visible && (
                  <span
                    className="text-[0.7rem] text-muted-foreground border border-border rounded-md px-1.5 py-0"
                    title="Hidden from listeners"
                  >
                    Hidden
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{channel.outputFormat}</span>
                <span>
                  {channel.sources.length} source{channel.sources.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Reorder buttons */}
              <button
                type="button"
                className="bg-transparent border border-border rounded-md text-muted-foreground size-7 text-xs inline-flex items-center justify-center cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={index === 0}
                onClick={() => handleMoveUp(index)}
                title="Move up"
              >
                &#9650;
              </button>
              <button
                type="button"
                className="bg-transparent border border-border rounded-md text-muted-foreground size-7 text-xs inline-flex items-center justify-center cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
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
                  className="px-3 py-1.5 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-sm cursor-pointer transition-all hover:bg-destructive/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => onStopChannel(channel.id)}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="px-3 py-1.5 bg-transparent border border-success text-success rounded-md text-sm cursor-pointer transition-all hover:bg-success/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => onStartChannel(channel.id)}
                >
                  Start
                </button>
              )}

              {/* Configure */}
              <button
                type="button"
                className="px-3 py-1.5 bg-transparent border border-border rounded-md text-muted-foreground text-sm cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => onConfigureChannel(channel.id)}
              >
                Configure
              </button>

              {/* Remove */}
              <button
                type="button"
                className="bg-transparent border border-transparent rounded-md text-destructive size-7 text-xs inline-flex items-center justify-center cursor-pointer transition-all hover:border-destructive/50 hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
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
