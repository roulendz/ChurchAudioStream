/**
 * Per-channel audio processing controls: Speech/Music mode toggle,
 * AGC enable/disable, and AGC target slider.
 *
 * Sends `channel:processing:update` WS messages with debounced slider
 * values to avoid flooding the server during drag.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

type AudioMode = "speech" | "music";

interface ProcessingState {
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

/** Minimum and maximum target LUFS values for the AGC slider. */
const MIN_TARGET_LUFS = -20;
const MAX_TARGET_LUFS = -14;

/** Debounce delay for slider changes (ms). */
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

  // Sync local state when server pushes updates
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

    // Debounce slider to avoid flooding during drag
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      sendProcessingUpdate({ agc: { targetLufs: value } });
      debounceTimerRef.current = null;
    }, SLIDER_DEBOUNCE_MS);
  }

  function handleTargetLufsCommit() {
    // On mouseup/touchend, send immediately (cancel pending debounce)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    sendProcessingUpdate({ agc: { targetLufs: localTargetLufs } });
  }

  // Cleanup debounce timer on unmount
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

      {/* AGC enabled toggle */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={localAgcEnabled}
            onChange={(e) => handleAgcEnabledChange(e.target.checked)}
            className="accent-primary"
          />
          AGC (Auto Gain Control)
        </label>
      </div>

      {/* FEC (Forward Error Correction) toggle */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={localFecEnabled}
            onChange={(e) => handleFecChange(e.target.checked)}
            className="accent-primary"
          />
          FEC (Forward Error Correction)
        </label>
        <span className="text-xs text-muted-foreground ml-6">
          {localFecEnabled
            ? `+${processing.opus.frameSizeMs}ms latency, recovers lost packets on WiFi`
            : "Off — lost packets cause audio gaps"}
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
