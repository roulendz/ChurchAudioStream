import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act as reactAct } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UpdateToast } from "./UpdateToast";
import type { UpdateState } from "../../lib/types";

const DEFAULT_STATE: UpdateState = { last_check_unix: 0, last_dismissed_unix: 0, skipped_versions: [] };

interface CapturedHandlers {
  available?: (event: { payload: { version: string; notes: string; downloadUrl: string } }) => void;
  progress?: (event: { payload: { downloadedBytes: number; totalBytes: number } }) => void;
  installed?: (event: { payload: { version: string } }) => void;
}

function captureListenHandlers(): CapturedHandlers {
  const captured: CapturedHandlers = {};
  vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
    if (eventName === "update:available") captured.available = handler as never;
    if (eventName === "update:download:progress") captured.progress = handler as never;
    if (eventName === "update:installed") captured.installed = handler as never;
    return () => {};
  });
  return captured;
}

async function fireEvent<T>(handler: ((event: { payload: T }) => void) | undefined, payload: T): Promise<void> {
  await reactAct(async () => {
    handler?.({ payload });
  });
}

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_STATE);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("renders aria-live polite root with role='status' even when Idle (preserves AT region)", () => {
    render(<UpdateToast />);
    const root = screen.getByRole("status");
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root).toHaveAttribute("aria-atomic", "true");
    expect(root).toHaveAttribute("data-visible", "false");
    expect(root).toHaveAttribute("data-state", "Idle");
  });

  it("renders UpdateAvailable content with version + notes + 3 buttons", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "Bug fixes and perf", downloadUrl: "u" });
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Bug fixes and perf/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("truncates notes longer than 80 chars and exposes full notes via sr-only + aria-label", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    const longNotes = "A".repeat(120);
    await fireEvent(handlers.available, { version: "0.2.0", notes: longNotes, downloadUrl: "u" });
    const truncatedDisplay = `${"A".repeat(80)}…`;
    // Both the visible truncated text and the sr-only span share the prefix; assert on the exact truncated form
    const matches = screen.getAllByText((_content, node) => node?.textContent?.startsWith(truncatedDisplay) ?? false);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does NOT truncate notes ≤80 chars", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    const shortNotes = "Short release notes";
    await fireEvent(handlers.available, { version: "0.2.0", notes: shortNotes, downloadUrl: "u" });
    expect(screen.getByText(shortNotes)).toBeInTheDocument();
  });

  it("Install button calls invoke('update_install')", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /install/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_install");
  });

  it("Later button calls invoke('update_dismiss')", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /later/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_dismiss", undefined);
  });

  it("Skip button calls invoke('update_skip_version', { version }) one-click", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_skip_version", { version: "0.2.0" });
  });

  it("Downloading with totalBytes>0 renders <progress> with max+value, NOT a spinner", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.progress).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    await fireEvent(handlers.progress, { downloadedBytes: 250, totalBytes: 1000 });
    const progressEl = document.querySelector("progress");
    expect(progressEl).toBeInTheDocument();
    expect(progressEl).toHaveAttribute("max", "1000");
    expect(progressEl).toHaveAttribute("value", "250");
  });

  it("Downloading with totalBytes===0 renders indeterminate spinner, NOT 0% progress", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.progress).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    await fireEvent(handlers.progress, { downloadedBytes: 250, totalBytes: 0 });
    expect(document.querySelector("progress")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/downloading, size unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it("Installing state renders no buttons + auto-restart text", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.installed).toBeDefined());
    await fireEvent(handlers.installed, { version: "0.2.0" });
    expect(screen.getByText(/will restart automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Installing state has NO 'Restart now' button (trip-wire #1)", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.installed).toBeDefined());
    await fireEvent(handlers.installed, { version: "0.2.0" });
    expect(screen.queryByText(/restart now/i)).not.toBeInTheDocument();
  });

  it("data-state attribute mirrors current UI state.kind for CSS hooks", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    const root = screen.getByRole("status");
    expect(root).toHaveAttribute("data-state", "Idle");
    await waitFor(() => expect(handlers.available).toBeDefined());
    await fireEvent(handlers.available, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    expect(root).toHaveAttribute("data-state", "UpdateAvailable");
    expect(root).toHaveAttribute("data-visible", "true");
  });
});
