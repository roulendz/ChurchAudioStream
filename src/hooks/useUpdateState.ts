import { useEffect, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { updateReducer, type UpdateUiState } from "./updateStateMachine";
import type { UpdateState } from "../lib/types";

const INITIAL: UpdateUiState = { kind: "Idle" };

interface AvailablePayload { version: string; notes: string; downloadUrl: string }
interface ProgressPayload { downloadedBytes: number; totalBytes: number }
interface InstalledPayload { version: string }

/**
 * Subscribe to Phase 3 update:* events and expose typed UI state +
 * action creators that wrap Tauri `invoke()` calls.
 *
 * StrictMode safety: aborted-flag pattern per repo decision [01-08].
 * The first effect mount registers listeners; cleanup unlistens. Under
 * StrictMode-dev-double-fire, the second mount registers fresh listeners
 * after the first cleanup completes — no double-subscription leak.
 */
export function useUpdateState() {
  const [state, dispatch] = useReducer(updateReducer, INITIAL);
  const [persisted, setPersisted] = useState<UpdateState | null>(null);

  useEffect(() => {
    let aborted = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      const a = await listen<AvailablePayload>("update:available", (event) => {
        dispatch({
          type: "available",
          version: event.payload.version,
          notes: event.payload.notes,
          downloadUrl: event.payload.downloadUrl,
        });
      });
      const p = await listen<ProgressPayload>("update:download:progress", (event) => {
        dispatch({
          type: "progress",
          downloadedBytes: event.payload.downloadedBytes,
          totalBytes: event.payload.totalBytes,
        });
      });
      const i = await listen<InstalledPayload>("update:installed", (event) => {
        dispatch({ type: "installed", version: event.payload.version });
      });
      if (aborted) {
        a(); p(); i();
        return;
      }
      unlistens.push(a, p, i);
    })().catch((error) => {
      console.warn("useUpdateState: listener registration failed", error);
    });

    return () => {
      aborted = true;
      for (const fn of unlistens) fn();
    };
  }, []);

  useEffect(() => {
    invoke<UpdateState>("update_get_state")
      .then(setPersisted)
      .catch((error) => console.warn("useUpdateState: update_get_state failed", error));
  }, []);

  const checkNow = async (): Promise<UpdateState> => {
    const result = await invoke<UpdateState>("update_check_now");
    setPersisted(result);
    dispatch({ type: "checkCompleted", lastCheckUnix: result.last_check_unix });
    return result;
  };

  const install = async (): Promise<void> => {
    await invoke<void>("update_install");
  };

  const dismiss = async (): Promise<void> => {
    await invoke<void>("update_dismiss");
    dispatch({ type: "dismissed" });
  };

  const skip = async (version: string): Promise<void> => {
    await invoke<void>("update_skip_version", { version });
    dispatch({ type: "skipped", version });
  };

  return {
    state,
    lastCheckUnix: persisted?.last_check_unix ?? 0,
    skippedVersions: persisted?.skipped_versions ?? [],
    checkNow,
    install,
    dismiss,
    skip,
  };
}
