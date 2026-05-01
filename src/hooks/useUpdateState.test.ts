import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUpdateState } from "./useUpdateState";
import type { UpdateState } from "../lib/types";

const DEFAULT_STATE: UpdateState = {
  last_check_unix: 0,
  last_dismissed_unix: 0,
  skipped_versions: [],
};

describe("useUpdateState", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_STATE);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("registers three listeners on mount", async () => {
    renderHook(() => useUpdateState());
    await waitFor(() => {
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:available", expect.any(Function));
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:download:progress", expect.any(Function));
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:installed", expect.any(Function));
    });
  });

  it("calls all three unlisten fns on unmount", async () => {
    const unlistenSpies = [vi.fn(), vi.fn(), vi.fn()];
    vi.mocked(listen)
      .mockResolvedValueOnce(unlistenSpies[0]!)
      .mockResolvedValueOnce(unlistenSpies[1]!)
      .mockResolvedValueOnce(unlistenSpies[2]!);

    const { unmount } = renderHook(() => useUpdateState());
    await waitFor(() => expect(vi.mocked(listen)).toHaveBeenCalledTimes(3));
    unmount();
    await waitFor(() => {
      for (const spy of unlistenSpies) expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it("aborted-flag path: unmount before async listen completes still calls all unlistens", async () => {
    const unlistenSpies = [vi.fn(), vi.fn(), vi.fn()];
    // Delay each listen() resolution so unmount happens BEFORE the
    // unlistens.push(a, p, i) line runs. The aborted-flag branch then
    // calls a(); p(); i(); inside the IIFE (not via cleanup return).
    const delays = [50, 30, 20];
    let callIndex = 0;
    vi.mocked(listen).mockImplementation(() => {
      const idx = callIndex++;
      const spy = unlistenSpies[idx]!;
      return new Promise<() => void>((resolve) => {
        setTimeout(() => resolve(spy), delays[idx]);
      });
    });

    const { unmount } = renderHook(() => useUpdateState());
    unmount(); // abort before first listen resolves
    await waitFor(() => {
      for (const spy of unlistenSpies) expect(spy).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });
  });

  it("hydrates persisted state on mount via update_get_state", async () => {
    const persisted: UpdateState = {
      last_check_unix: 1_700_000_000,
      last_dismissed_unix: 0,
      skipped_versions: ["0.1.5"],
    };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_get_state") return persisted;
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(result.current.lastCheckUnix).toBe(1_700_000_000));
    expect(result.current.skippedVersions).toEqual(["0.1.5"]);
  });

  it("dispatches available when update:available event fires", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(availableHandler).not.toBeNull());
    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "release notes", downloadUrl: "https://x/y" } });
    });
    expect(result.current.state).toEqual({
      kind: "UpdateAvailable",
      version: "0.2.0",
      notes: "release notes",
      downloadUrl: "https://x/y",
    });
  });

  it("dispatches progress when update:download:progress event fires", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    let progressHandler: ((event: { payload: { downloadedBytes: number; totalBytes: number } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      if (eventName === "update:download:progress") progressHandler = handler as typeof progressHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(progressHandler).not.toBeNull());
    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
      progressHandler!({ payload: { downloadedBytes: 100, totalBytes: 1000 } });
    });
    expect(result.current.state).toMatchObject({
      kind: "Downloading",
      downloadedBytes: 100,
      totalBytes: 1000,
    });
  });

  it("dispatches installed when update:installed event fires", async () => {
    let installedHandler: ((event: { payload: { version: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:installed") installedHandler = handler as typeof installedHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(installedHandler).not.toBeNull());
    await act(async () => installedHandler!({ payload: { version: "0.2.0" } }));
    expect(result.current.state).toEqual({ kind: "Installing", version: "0.2.0" });
  });

  it("checkNow invokes update_check_now and sets persisted (Idle path → UpToDate)", async () => {
    const checkResult: UpdateState = { last_check_unix: 1700, last_dismissed_unix: 0, skipped_versions: [] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return checkResult;
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.checkNow(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_check_now");
    expect(result.current.lastCheckUnix).toBe(1700);
    expect(result.current.state).toEqual({ kind: "UpToDate", checkedAtUnix: 1700 });
  });

  it("checkNow dispatches updateOffered=true when state is already UpdateAvailable (preserves UpdateAvailable)", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      return () => {};
    });
    const checkResult: UpdateState = { last_check_unix: 1700, last_dismissed_unix: 0, skipped_versions: [] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return checkResult;
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(availableHandler).not.toBeNull());
    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
    });
    await act(async () => { await result.current.checkNow(); });
    expect(result.current.state.kind).toBe("UpdateAvailable");
  });

  it("install invokes update_install (no args)", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.install(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_install");
  });

  it("dismiss invokes update_dismiss and dispatches dismissed → Idle", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.dismiss(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_dismiss");
    expect(result.current.state).toEqual({ kind: "Idle" });
  });

  it("skip invokes update_skip_version with { version } and dispatches skipped → SilentSkip", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.skip("0.2.0"); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_skip_version", { version: "0.2.0" });
    expect(result.current.state).toEqual({ kind: "SilentSkip", skippedVersion: "0.2.0" });
  });

  it("logs warning when listener registration throws (does not crash)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listen).mockRejectedValue(new Error("tauri runtime missing"));
    expect(() => renderHook(() => useUpdateState())).not.toThrow();
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
  });

  it("logs warning when update_get_state throws (does not crash)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_get_state") throw new Error("not available");
      return DEFAULT_STATE;
    });
    expect(() => renderHook(() => useUpdateState())).not.toThrow();
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
  });
});
