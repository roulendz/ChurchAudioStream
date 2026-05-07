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
import { Switch } from "@/components/ui/switch";
import {
  Play,
  Square,
  Settings,
  Trash2,
  GripVertical,
  EyeOff,
} from "lucide-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "@/lib/utils";
import { ChannelStatusBadge } from "./ChannelStatusBadge";
import { VuMeter } from "@/components/monitoring/VuMeter";
import type { AdminChannel } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";

export interface ChannelCardProps {
  channel: AdminChannel;
  index: number;
  getLevels: (channelId: string) => ChannelLevelData | null;
  onStart: (channelId: string) => void;
  onStop: (channelId: string) => void;
  onConfigure: (channelId: string) => void;
  onRemove: (channelId: string) => void;
  sendMessage?: (type: string, payload?: unknown) => void;
}

function getProcessingField<T>(
  processing: unknown,
  path: string[],
  fallback: T,
): T {
  let current: unknown = processing;
  for (const key of path) {
    if (current == null || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return (current as T) ?? fallback;
}

export function ChannelCard({
  channel,
  index,
  getLevels,
  onStart,
  onStop,
  onConfigure,
  onRemove,
  sendMessage,
}: ChannelCardProps) {
  const { ref, handleRef, isDragSource } = useSortable({
    id: channel.id,
    index,
  });

  const isRunning =
    channel.status === "streaming" || channel.status === "starting";

  const fecEnabled = getProcessingField<boolean>(channel.processing, ["opus", "fec"], false);
  const agcEnabled = getProcessingField<boolean>(channel.processing, ["agc", "enabled"], false);

  const getChannelLevels = useCallback(
    () => getLevels(channel.id),
    [getLevels, channel.id],
  );

  const handleFecToggle = useCallback(
    (checked: boolean) => {
      sendMessage?.("channel:processing:update", {
        channelId: channel.id,
        opus: { fec: checked },
      });
    },
    [channel.id, sendMessage],
  );

  const handleAgcToggle = useCallback(
    (checked: boolean) => {
      sendMessage?.("channel:processing:update", {
        channelId: channel.id,
        agc: { enabled: checked },
      });
    },
    [channel.id, sendMessage],
  );

  return (
    <Card
      ref={ref}
      className={cn(
        "transition-shadow",
        isDragSource && "opacity-50 ring-2 ring-primary/50 shadow-lg"
      )}
    >
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          <button
            ref={handleRef}
            className="cursor-grab active:cursor-grabbing touch-none p-0.5 rounded hover:bg-accent"
            aria-label="Drag to reorder"
          >
            <GripVertical className="size-4 text-muted-foreground" />
          </button>
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
              width={channel.outputFormat === "stereo" ? 32 : 24}
              height={56}
              channelCount={channel.outputFormat === "stereo" ? 2 : 1}
            />
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span>{channel.outputFormat}</span>
              <span>
                {channel.sources.length} source
                {channel.sources.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Quick toggles + action buttons */}
          <div className="flex items-center gap-2">
            {sendMessage && (
              <div className="flex items-center gap-2 mr-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <Switch
                        size="sm"
                        checked={fecEnabled}
                        onCheckedChange={handleFecToggle}
                        aria-label="Toggle FEC"
                      />
                      <span className="text-[0.65rem] text-muted-foreground uppercase tracking-wide">
                        FEC
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {fecEnabled ? "FEC on — recovers lost packets (+20ms)" : "FEC off — lost packets cause gaps"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <Switch
                        size="sm"
                        checked={agcEnabled}
                        onCheckedChange={handleAgcToggle}
                        aria-label="Toggle AGC"
                      />
                      <span className="text-[0.65rem] text-muted-foreground uppercase tracking-wide">
                        AGC
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {agcEnabled ? "AGC on — loudness normalization (+3s latency!)" : "AGC off — no loudness normalization"}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            <div className="flex items-center gap-1">
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
        </div>
      </CardContent>
    </Card>
  );
}
