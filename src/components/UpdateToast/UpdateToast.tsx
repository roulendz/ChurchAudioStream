import { useRef } from "react";
import styles from "./UpdateToast.module.css";
import { useUpdateState } from "../../hooks/useUpdateState";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { sanitizeReleaseNotes } from "../../lib/sanitize-notes";
import type { UpdateUiState } from "../../hooks/updateStateMachine";

interface AvailableProps {
  state: Extract<UpdateUiState, { kind: "UpdateAvailable" }>;
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
}
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const { display, full, truncated } = sanitizeReleaseNotes(state.notes);
  return (
    <div className={styles["toast-content"]}>
      <div className={styles["toast-headline"]}>Update available — v{state.version}</div>
      <div className={styles["toast-notes"]} aria-label={truncated ? full : undefined}>
        {display}
        {truncated && <span className={styles["sr-only"]}>{full}</span>}
      </div>
      <div className={styles["toast-actions"]}>
        <button type="button" className={styles["button-primary"]} onClick={onInstall}>
          Install
        </button>
        <button type="button" className={styles["button-secondary"]} onClick={onLater}>
          Later
        </button>
        <button type="button" className={styles["button-tertiary"]} onClick={onSkip}>
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
    <div className={styles["toast-content"]} aria-busy="true">
      <div className={styles["toast-headline"]}>Downloading v{state.version}…</div>
      {isIndeterminate ? (
        <div
          className={styles["spinner-indeterminate"]}
          role="progressbar"
          aria-label="downloading, size unknown"
          aria-valuetext="downloading, size unknown"
        />
      ) : (
        <progress
          className={styles["progress-bar"]}
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
    <div className={styles["toast-content"]} aria-busy="true">
      <div className={styles["toast-headline"]}>Installing v{state.version}</div>
      <div className={styles["spinner-indeterminate"]} role="progressbar" aria-label="installing" />
      <output className={styles["toast-text"]}>Installing — the app will restart automatically</output>
    </div>
  );
}

export function UpdateToast() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { state, install, dismiss, skip } = useUpdateState();
  const visible = state.kind !== "Idle";
  const trapActive = state.kind === "Installing";
  useFocusTrap(trapActive, containerRef);

  return (
    <div
      ref={containerRef}
      className={styles["toast-root"]}
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
