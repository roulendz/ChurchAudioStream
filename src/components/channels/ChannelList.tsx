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
        <ScrollArea className="h-[calc(100vh-12rem)]">
          <div className="flex flex-col gap-3 pr-4">
            {channels.map((channel, index) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                index={index}
                totalChannels={channels.length}
                getLevels={getLevels}
                onStart={onStartChannel}
                onStop={onStopChannel}
                onConfigure={onConfigureChannel}
                onRemove={onRemoveChannel}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
