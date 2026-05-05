import { useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Play,
  Square,
  Settings,
  Trash2,
  ChevronUp,
  ChevronDown,
  EyeOff,
} from "lucide-react";
import { ChannelStatusBadge } from "./ChannelStatusBadge";
import { VuMeter } from "@/components/monitoring/VuMeter";
import type { AdminChannel } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";

export interface ChannelCardProps {
  channel: AdminChannel;
  index: number;
  totalChannels: number;
  getLevels: (channelId: string) => ChannelLevelData | null;
  onStart: (channelId: string) => void;
  onStop: (channelId: string) => void;
  onConfigure: (channelId: string) => void;
  onRemove: (channelId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

export function ChannelCard({
  channel,
  index,
  totalChannels,
  getLevels,
  onStart,
  onStop,
  onConfigure,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ChannelCardProps) {
  const isRunning =
    channel.status === "streaming" || channel.status === "starting";

  const getChannelLevels = useCallback(
    () => getLevels(channel.id),
    [getLevels, channel.id],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="text-sm font-semibold truncate">
            {channel.name}
          </CardTitle>
          {!channel.visible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <EyeOff className="size-3 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Hidden from listeners</TooltipContent>
            </Tooltip>
          )}
        </div>
        <CardAction>
          <ChannelStatusBadge status={channel.status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <VuMeter
              channelName={channel.name}
              getLevels={getChannelLevels}
              width={24}
              height={56}
            />
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span>{channel.outputFormat}</span>
              <span>
                {channel.sources.length} source
                {channel.sources.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Reorder buttons -- Phase 14 replaces with drag handles */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => onMoveUp(index)}
                >
                  <ChevronUp className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move up</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={index === totalChannels - 1}
                  onClick={() => onMoveDown(index)}
                >
                  <ChevronDown className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Move down</TooltipContent>
            </Tooltip>

            {/* Start / Stop toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    isRunning ? onStop(channel.id) : onStart(channel.id)
                  }
                >
                  {isRunning ? (
                    <Square className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isRunning ? "Stop streaming" : "Start streaming"}
              </TooltipContent>
            </Tooltip>

            {/* Configure */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onConfigure(channel.id)}
                >
                  <Settings className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Configure channel</TooltipContent>
            </Tooltip>

            {/* Remove */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemove(channel.id)}
                >
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove channel</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
