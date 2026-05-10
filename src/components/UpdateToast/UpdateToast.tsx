import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useUpdateState } from "../../hooks/useUpdateState";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { sanitizeReleaseNotes } from "../../lib/sanitize-notes";
import type { UpdateUiState } from "../../hooks/updateStateMachine";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AvailableProps {
  state: Extract<UpdateUiState, { kind: "UpdateAvailable" }>;
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
}
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const { display, full, truncated } = sanitizeReleaseNotes(state.notes);
  return (
    <div className="flex flex-col gap-2 max-w-2xl mx-auto">
      <div className="font-semibold text-base text-foreground">Update available — v{state.version}</div>
      <div
        className="text-sm text-muted-foreground"
        aria-label={truncated ? full : undefined}
      >
        {display}
        {truncated && <span className="sr-only">{full}</span>}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className={cn(
            "px-4 py-1.5 rounded-md bg-success text-white text-sm font-medium",
            "border-none cursor-pointer transition-colors",
            "disabled:opacity-60 disabled:cursor-progress"
          )}
          onClick={onInstall}
        >
          Install
        </button>
        <button
          type="button"
          className={cn(
            "px-3 py-1.5 rounded-md bg-transparent border border-border",
            "text-foreground text-sm font-medium border-none cursor-pointer"
          )}
          onClick={onLater}
        >
          Later
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md bg-transparent text-muted-foreground text-sm font-medium border-none cursor-pointer"
          onClick={onSkip}
        >
          Skip this version
        </button>
      </div>
    </div>
  );
}

interface DownloadingProps {
  state: Extract<UpdateUiState, { kind: "Downloading" }>;
}
function DownloadingContent({ state }: DownloadingProps) {
  const isIndeterminate = state.totalBytes === 0;
  return (
    <div className="flex flex-col gap-2 max-w-2xl mx-auto" aria-busy="true">
      <div className="font-semibold text-base text-foreground">Downloading v{state.version}...</div>
      {isIndeterminate ? (
        <div
          className="size-6 border-[3px] border-border border-t-success rounded-full animate-spin motion-reduce:animate-none"
          role="progressbar"
          aria-label="downloading, size unknown"
          aria-valuetext="downloading, size unknown"
        />
      ) : (
        <progress
          className="w-full h-2"
          max={state.totalBytes}
          value={state.downloadedBytes}
          aria-label={`download progress ${state.downloadedBytes} of ${state.totalBytes} bytes`}
        />
      )}
    </div>
  );
}

interface InstallingProps {
  state: Extract<UpdateUiState, { kind: "Installing" }>;
}
function InstallingContent({ state }: InstallingProps) {
  return (
    <div className="flex flex-col gap-2 max-w-2xl mx-auto" aria-busy="true">
      <div className="font-semibold text-base text-foreground">Installing v{state.version}</div>
      <div
        className="size-6 border-[3px] border-border border-t-success rounded-full animate-spin motion-reduce:animate-none"
        role="progressbar"
        aria-label="installing"
      />
      <output className="text-sm text-foreground">
        Installing — the app will restart automatically
      </output>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UpdateToast
// ---------------------------------------------------------------------------

export function UpdateToast() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { state, install, dismiss, skip } = useUpdateState();
  const visible = state.kind !== "Idle";
  const trapActive = state.kind === "Installing";
  useFocusTrap(trapActive, containerRef);

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed top-0 inset-x-0 z-[1000]",
        "bg-card border-b border-border shadow-lg",
        "px-6 py-4 text-foreground",
        "transition-transform duration-[240ms] ease-out",
        !visible && "-translate-y-full pointer-events-none"
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-visible={visible}
      data-state={state.kind}
    >
      {state.kind === "UpdateAvailable" && (
        <AvailableContent
          state={state}
          onInstall={install}
          onLater={dismiss}
          onSkip={() => skip(state.version)}
        />
      )}
      {state.kind === "Downloading" && <DownloadingContent state={state} />}
      {state.kind === "Installing" && <InstallingContent state={state} />}
    </div>
  );
}
