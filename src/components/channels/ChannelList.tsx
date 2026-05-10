import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus } from "lucide-react";
import { ChannelCard } from "./ChannelCard";
import type { AdminChannel } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";

interface ChannelListProps {
  channels: AdminChannel[];
  onStartChannel: (channelId: string) => void;
  onStopChannel: (channelId: string) => void;
  onRemoveChannel: (channelId: string) => void;
  onConfigureChannel: (channelId: string) => void;
  onReorderChannels: (channelIds: string[]) => void;
  onCreateClick: () => void;
  getLevels: (channelId: string) => ChannelLevelData | null;
  sendMessage?: (type: string, payload?: unknown) => void;
}

export function ChannelList({
  channels,
  onStartChannel,
  onStopChannel,
  onRemoveChannel,
  onConfigureChannel,
  onReorderChannels,
  onCreateClick,
  getLevels,
  sendMessage,
}: ChannelListProps) {
  function handleDragEnd(event: Parameters<NonNullable<React.ComponentProps<typeof DragDropProvider>['onDragEnd']>>[0]) {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;

    const { initialIndex, index } = source.sortable;
    if (initialIndex === index) return;

    const ids = channels.map((ch) => ch.id);
    const [moved] = ids.splice(initialIndex, 1);
    ids.splice(index, 0, moved);
    onReorderChannels(ids);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Channels</h3>
        <Button onClick={onCreateClick}>
          <Plus className="size-4" />
          New Channel
        </Button>
      </div>

      {channels.length === 0 ? (
        <p className="text-muted-foreground italic py-8 text-center">
          No channels yet. Create one to get started.
        </p>
      ) : (
        <DragDropProvider onDragEnd={handleDragEnd}>
          <ScrollArea className="h-[calc(100vh-12rem)]">
            <div className="flex flex-col gap-3 pr-4">
              {channels.map((channel, index) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  index={index}
                  getLevels={getLevels}
                  onStart={onStartChannel}
                  onStop={onStopChannel}
                  onConfigure={onConfigureChannel}
                  onRemove={onRemoveChannel}
                  sendMessage={sendMessage}
                />
              ))}
            </div>
          </ScrollArea>
        </DragDropProvider>
      )}
    </div>
  );
}
