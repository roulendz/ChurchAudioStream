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
  ShieldCheck,
  AudioLines,
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

function TogglePill({
  checked,
  onCheckedChange,
  label,
  icon: Icon,
  activeHint,
  inactiveHint,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeHint: string;
  inactiveHint: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors select-none",
            checked
              ? "border-primary/40 bg-primary/10"
              : "border-border bg-transparent hover:bg-accent/30",
          )}
        >
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              checked ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "text-xs font-medium tracking-wide",
              checked ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            size="sm"
          />
        </label>
      </TooltipTrigger>
      <TooltipContent>{checked ? activeHint : inactiveHint}</TooltipContent>
    </Tooltip>
  );
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
        <div className="flex items-center justify-between gap-3">
          {/* Left: VU meter + channel info */}
          <div className="flex items-center gap-3 shrink-0">
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

          {/* Center: Processing toggle pills */}
          {sendMessage && (
            <div className="flex items-center gap-1.5">
              <TogglePill
                checked={fecEnabled}
                onCheckedChange={handleFecToggle}
                label="FEC"
                icon={ShieldCheck}
                activeHint="FEC on — recovers lost packets (+20ms)"
                inactiveHint="FEC off — lost packets cause gaps"
              />
              <TogglePill
                checked={agcEnabled}
                onCheckedChange={handleAgcToggle}
                label="AGC"
                icon={AudioLines}
                activeHint="AGC on — loudness normalization (+3s latency!)"
                inactiveHint="AGC off — no loudness normalization"
              />
            </div>
          )}

          {/* Right: Transport + Settings */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    isRunning ? onStop(channel.id) : onStart(channel.id)
                  }
                >
                  {isRunning ? (
                    <Square className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
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
                  size="icon-sm"
                  onClick={() => onRemove(channel.id)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove channel</TooltipContent>
            </Tooltip>

            <div className="w-px h-5 bg-border mx-0.5" />

            <Button
              variant="outline"
              size="xs"
              onClick={() => onConfigure(channel.id)}
            >
              <Settings className="size-3" />
              Settings
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
