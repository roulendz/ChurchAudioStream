import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProcessingToggle } from "./useProcessingToggle";

describe("useProcessingToggle", () => {
  const mockPeer = {
    request: vi
      .fn()
      .mockResolvedValue({ channelId: "ch1", processingEnabled: false }),
  };

  it("initializes with processing enabled by default", () => {
    const { result } = renderHook(() => useProcessingToggle());
    expect(result.current.processingEnabled).toBe(true);
  });

  it("initializes with custom initial state", () => {
    const { result } = renderHook(() => useProcessingToggle(false));
    expect(result.current.processingEnabled).toBe(false);
  });

  it("toggle sends toggleProcessing request with correct payload", async () => {
    const { result } = renderHook(() => useProcessingToggle(true));
    await act(async () => {
      await result.current.toggle("channel-1", mockPeer as any);
    });
    expect(mockPeer.request).toHaveBeenCalledWith("toggleProcessing", {
      channelId: "channel-1",
      enabled: false,
    });
    expect(result.current.processingEnabled).toBe(false);
  });

  it("reverts on request failure", async () => {
    const failPeer = { request: vi.fn().mockRejectedValue(new Error("fail")) };
    const { result } = renderHook(() => useProcessingToggle(true));
    await act(async () => {
      await result.current.toggle("ch1", failPeer as any);
    });
    expect(result.current.processingEnabled).toBe(true); // reverted
  });

  it("setProcessingEnabled updates state directly", () => {
    const { result } = renderHook(() => useProcessingToggle(true));
    act(() => result.current.setProcessingEnabled(false));
    expect(result.current.processingEnabled).toBe(false);
  });
});
