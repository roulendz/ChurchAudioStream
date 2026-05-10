/**
 * Per-channel audio processing controls: Speech/Music mode toggle,
 * AGC enable/disable, FEC enable/disable, and AGC target slider.
 *
 * Uses Switch for toggles and HoverCard for detailed explanations.
 * Sends `channel:processing:update` WS messages with debounced slider
 * values to avoid flooding the server during drag.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { Info } from "lucide-react";

type AudioMode = "speech" | "music";

export interface ProcessingState {
  mode: string;
  agc: {
    enabled: boolean;
    targetLufs: number;
  };
  opus: {
    fec: boolean;
    frameSizeMs: number;
  };
}

interface ProcessingControlsProps {
  channelId: string;
  processing: ProcessingState;
  sendMessage: (type: string, payload?: unknown) => void;
}

const MIN_TARGET_LUFS = -20;
const MAX_TARGET_LUFS = -14;
const SLIDER_DEBOUNCE_MS = 300;

export function ProcessingControls({
  channelId,
  processing,
  sendMessage,
}: ProcessingControlsProps) {
  const [localMode, setLocalMode] = useState<AudioMode>(
    processing.mode === "music" ? "music" : "speech",
  );
  const [localAgcEnabled, setLocalAgcEnabled] = useState(processing.agc.enabled);
  const [localTargetLufs, setLocalTargetLufs] = useState(processing.agc.targetLufs);
  const [localFecEnabled, setLocalFecEnabled] = useState(processing.opus.fec);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalMode(processing.mode === "music" ? "music" : "speech");
    setLocalAgcEnabled(processing.agc.enabled);
    setLocalTargetLufs(processing.agc.targetLufs);
    setLocalFecEnabled(processing.opus.fec);
  }, [processing.mode, processing.agc.enabled, processing.agc.targetLufs, processing.opus.fec]);

  const sendProcessingUpdate = useCallback(
    (update: Record<string, unknown>) => {
      sendMessage("channel:processing:update", {
        channelId,
        ...update,
      });
    },
    [channelId, sendMessage],
  );

  function handleModeChange(mode: AudioMode) {
    setLocalMode(mode);
    sendProcessingUpdate({ mode });
  }

  function handleAgcEnabledChange(enabled: boolean) {
    setLocalAgcEnabled(enabled);
    sendProcessingUpdate({ agc: { enabled } });
  }

  function handleFecChange(enabled: boolean) {
    setLocalFecEnabled(enabled);
    sendProcessingUpdate({ opus: { fec: enabled } });
  }

  function handleTargetLufsChange(value: number) {
    setLocalTargetLufs(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      sendProcessingUpdate({ agc: { targetLufs: value } });
      debounceTimerRef.current = null;
    }, SLIDER_DEBOUNCE_MS);
  }

  function handleTargetLufsCommit() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    sendProcessingUpdate({ agc: { targetLufs: localTargetLufs } });
  }

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold text-foreground mb-1">Audio Processing</h4>

      {/* Speech/Music mode toggle */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">Mode</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden self-start">
          <button
            type="button"
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-colors border-r border-border",
              localMode === "speech"
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => handleModeChange("speech")}
          >
            Speech
          </button>
          <button
            type="button"
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-colors",
              localMode === "music"
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => handleModeChange("music")}
          >
            Music
          </button>
        </div>
      </div>

      {/* FEC toggle */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id={`fec-${channelId}`}
              checked={localFecEnabled}
              onCheckedChange={handleFecChange}
              size="sm"
            />
            <label
              htmlFor={`fec-${channelId}`}
              className="text-sm text-foreground cursor-pointer"
            >
              FEC
            </label>
            <HoverCard openDelay={200}>
              <HoverCardTrigger asChild>
                <Info className="size-3.5 text-muted-foreground cursor-help" />
              </HoverCardTrigger>
              <HoverCardContent side="right" className="w-72 text-sm">
                <p className="font-semibold mb-1">Forward Error Correction</p>
                <p className="text-muted-foreground">
                  Opus embeds redundant data from the previous frame in each packet.
                  If a packet is lost, the receiver reconstructs the missing audio
                  from the next packet instead of playing silence/clicks.
                </p>
                <p className="text-muted-foreground mt-2">
                  <span className="font-medium text-foreground">Latency:</span>{" "}
                  +{processing.opus.frameSizeMs}ms (one frame). Bitrate increases ~30-50%.
                  Recommended when packet loss &gt; 1%.
                </p>
              </HoverCardContent>
            </HoverCard>
          </div>
        </div>
        <span className="text-xs text-muted-foreground ml-9">
          {localFecEnabled
            ? `+${processing.opus.frameSizeMs}ms latency, recovers lost packets`
            : "Off — lost packets cause audio gaps"}
        </span>
      </div>

      {/* AGC toggle */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id={`agc-${channelId}`}
              checked={localAgcEnabled}
              onCheckedChange={handleAgcEnabledChange}
              size="sm"
            />
            <label
              htmlFor={`agc-${channelId}`}
              className="text-sm text-foreground cursor-pointer"
            >
              AGC
            </label>
            <HoverCard openDelay={200}>
              <HoverCardTrigger asChild>
                <Info className="size-3.5 text-muted-foreground cursor-help" />
              </HoverCardTrigger>
              <HoverCardContent side="right" className="w-72 text-sm">
                <p className="font-semibold mb-1">Auto Gain Control</p>
                <p className="text-muted-foreground">
                  Normalizes loudness using EBU R128 (audioloudnorm). Quiet and loud
                  sources on different channels produce similar perceived volume
                  for listeners.
                </p>
                <p className="text-destructive mt-2 font-medium">
                  +3000ms latency (3s EBU R128 lookahead window).
                </p>
                <p className="text-muted-foreground mt-1">
                  Not suitable for low-latency live streaming. Use only when
                  consistent loudness across sources matters more than delay.
                </p>
              </HoverCardContent>
            </HoverCard>
          </div>
        </div>
        <span className="text-xs text-muted-foreground ml-9">
          {localAgcEnabled
            ? "+3000ms latency — EBU R128 lookahead"
            : "Off — no loudness normalization"}
        </span>
      </div>

      {/* AGC target slider */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">
          Target Loudness: {localTargetLufs} LUFS
        </span>
        <input
          type="range"
          min={MIN_TARGET_LUFS}
          max={MAX_TARGET_LUFS}
          step={1}
          value={localTargetLufs}
          onChange={(e) => handleTargetLufsChange(Number(e.target.value))}
          onMouseUp={handleTargetLufsCommit}
          onTouchEnd={handleTargetLufsCommit}
          disabled={!localAgcEnabled}
          className="w-full accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{MIN_TARGET_LUFS}</span>
          <span>{MAX_TARGET_LUFS}</span>
        </div>
      </div>
    </div>
  );
}
