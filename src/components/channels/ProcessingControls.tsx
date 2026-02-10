/**
 * Per-channel audio processing controls: Speech/Music mode toggle,
 * AGC enable/disable, and AGC target slider.
 *
 * Sends `channel:processing:update` WS messages with debounced slider
 * values to avoid flooding the server during drag.
 */

import { useState, useEffect, useRef, useCallback } from "react";

type AudioMode = "speech" | "music";

interface ProcessingState {
  mode: string;
  agc: {
    enabled: boolean;
    targetLufs: number;
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

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when server pushes updates
  useEffect(() => {
    setLocalMode(processing.mode === "music" ? "music" : "speech");
    setLocalAgcEnabled(processing.agc.enabled);
    setLocalTargetLufs(processing.agc.targetLufs);
  }, [processing.mode, processing.agc.enabled, processing.agc.targetLufs]);

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
    <div className="processing-controls">
      <h4 className="config-section-title">Audio Processing</h4>

      {/* Speech/Music mode toggle */}
      <div className="processing-field">
        <label className="processing-label">Mode</label>
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-toggle-btn ${localMode === "speech" ? "mode-toggle-btn--active" : ""}`}
            onClick={() => handleModeChange("speech")}
          >
            Speech
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${localMode === "music" ? "mode-toggle-btn--active" : ""}`}
            onClick={() => handleModeChange("music")}
          >
            Music
          </button>
        </div>
      </div>

      {/* AGC enabled toggle */}
      <div className="processing-field">
        <label className="processing-checkbox-label">
          <input
            type="checkbox"
            checked={localAgcEnabled}
            onChange={(e) => handleAgcEnabledChange(e.target.checked)}
          />
          AGC (Auto Gain Control)
        </label>
      </div>

      {/* AGC target slider */}
      <div className="processing-field">
        <label className="processing-label">
          Target Loudness: {localTargetLufs} LUFS
        </label>
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
          className="processing-slider"
        />
        <div className="processing-slider-labels">
          <span>{MIN_TARGET_LUFS}</span>
          <span>{MAX_TARGET_LUFS}</span>
        </div>
      </div>
    </div>
  );
}
