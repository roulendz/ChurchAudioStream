import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act as reactAct } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CheckForUpdatesButton } from "./CheckForUpdatesButton";
import type { UpdateState } from "../../lib/types";

const NOW_SEC = Math.floor(Date.now() / 1000);
const STATE_RECENT: UpdateState = {
  last_check_unix: NOW_SEC - 7200,
  last_dismissed_unix: 0,
  skipped_versions: [],
};

describe("CheckForUpdatesButton", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(STATE_RECENT);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("renders title + Check now button", () => {
    render(<CheckForUpdatesButton />);
    expect(screen.getByText(/check for updates/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check now/i })).toBeInTheDocument();
  });

  it("renders 'Last checked: never' when last_check_unix is 0", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...STATE_RECENT, last_check_unix: 0 });
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.getByText(/last checked: never/i)).toBeInTheDocument());
  });

  it("renders humanized last-checked subtext (e.g. '2 hours ago')", async () => {
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.getByText(/last checked: 2 hours ago/i)).toBeInTheDocument());
  });

  it("clicking Check now invokes update_check_now and shows spinner during pending", async () => {
    let resolveCheck: (value: UpdateState) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return new Promise<UpdateState>((res) => { resolveCheck = res; });
      return STATE_RECENT;
    });
    render(<CheckForUpdatesButton />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /check now/i });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByLabelText(/checking/i)).toBeInTheDocument();
    resolveCheck!(STATE_RECENT);
    await waitFor(() => expect(screen.getByRole("button", { name: /check now/i })).not.toBeDisabled());
  });

  it("renders skipped-version chips when skipped_versions non-empty", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...STATE_RECENT, skipped_versions: ["0.1.5", "0.1.6"] });
    render(<CheckForUpdatesButton />);
    await waitFor(() => {
      expect(screen.getByText(/skipped: v0\.1\.5/i)).toBeInTheDocument();
      expect(screen.getByText(/skipped: v0\.1\.6/i)).toBeInTheDocument();
    });
  });

  it("does NOT render chip row when skipped_versions empty", async () => {
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.queryByText(/skipped: v/i)).not.toBeInTheDocument());
  });

  it("renders inline 'Up to date' result after checkCompleted with no update", async () => {
    render(<CheckForUpdatesButton />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /check now/i });
    await user.click(button);
    await waitFor(() => expect(screen.getByText(/up to date/i)).toBeInTheDocument());
  });

  it("renders inline 'Update available' result when state becomes UpdateAvailable", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as never;
      return () => {};
    });
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(availableHandler).not.toBeNull());
    await reactAct(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
    });
    await waitFor(() => expect(screen.getByText(/update available — see banner/i)).toBeInTheDocument());
  });

  it("logs warning and clears spinner when checkNow throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") throw new Error("network down");
      return STATE_RECENT;
    });
    render(<CheckForUpdatesButton />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /check now/i });
    await user.click(button);
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(button).not.toBeDisabled();
    warnSpy.mockRestore();
  });

  it("re-humanizes last-checked subtext on 60s tick", async () => {
    // Set up fake timers BEFORE render so the component's setInterval is
    // captured by the fake-timer subsystem.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(invoke).mockResolvedValue(STATE_RECENT);
      render(<CheckForUpdatesButton />);
      await waitFor(() => expect(screen.getByText(/last checked: 2 hours ago/i)).toBeInTheDocument());

      // Move system clock forward by 1 hour (3600s). last_check_unix unchanged
      // (NOW_SEC - 7200), so new delta = 7200 + 3600 = 10800s = "3 hours ago".
      await reactAct(async () => {
        vi.setSystemTime(Date.now() + 3_600_000);
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/last checked: 3 hours ago/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
