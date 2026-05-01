export type UpdateUiState =
  | { kind: "Idle" }
  | { kind: "UpdateAvailable"; version: string; notes: string; downloadUrl: string }
  | { kind: "Downloading"; version: string; downloadedBytes: number; totalBytes: number }
  | { kind: "Installing"; version: string }
  | { kind: "UpToDate"; checkedAtUnix: number }
  | { kind: "SilentSkip"; skippedVersion: string };

export type UpdateAction =
  | { type: "available"; version: string; notes: string; downloadUrl: string }
  | { type: "progress"; downloadedBytes: number; totalBytes: number }
  | { type: "installed"; version: string }
  | { type: "checkCompleted"; lastCheckUnix: number; updateOffered: boolean }
  | { type: "dismissed" }
  | { type: "skipped"; version: string }
  | { type: "reset" };

/**
 * Pure reducer for update UI state. No clock, no IO, no React. Exported
 * separately so tests run without the React renderer.
 */
export function updateReducer(state: UpdateUiState, action: UpdateAction): UpdateUiState {
  switch (action.type) {
    case "available":
      return {
        kind: "UpdateAvailable",
        version: action.version,
        notes: action.notes,
        downloadUrl: action.downloadUrl,
      };
    case "progress": {
      if (state.kind !== "Downloading" && state.kind !== "UpdateAvailable") return state;
      const version = state.version;
      return {
        kind: "Downloading",
        version,
        downloadedBytes: action.downloadedBytes,
        totalBytes: action.totalBytes,
      };
    }
    case "installed":
      return { kind: "Installing", version: action.version };
    case "checkCompleted":
      if (action.updateOffered) return state;
      return { kind: "UpToDate", checkedAtUnix: action.lastCheckUnix };
    case "dismissed":
      return { kind: "Idle" };
    case "skipped":
      return { kind: "SilentSkip", skippedVersion: action.version };
    case "reset":
      return { kind: "Idle" };
  }
}
