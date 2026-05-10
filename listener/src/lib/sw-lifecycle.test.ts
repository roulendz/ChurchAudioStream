import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  forceVersionReload,
  unregisterAllServiceWorkers,
  registerControllerChangeListener,
} from "./sw-lifecycle";

describe("unregisterAllServiceWorkers", () => {
  beforeEach(() => {
    vi.mocked(navigator.serviceWorker.getRegistrations).mockResolvedValue([]);
  });

  it("calls getRegistrations and unregisters each", async () => {
    const mockReg = { unregister: vi.fn().mockResolvedValue(true) } as unknown as ServiceWorkerRegistration;
    vi.mocked(navigator.serviceWorker.getRegistrations).mockResolvedValue([mockReg]);

    await unregisterAllServiceWorkers();

    expect(mockReg.unregister).toHaveBeenCalledOnce();
  });

  it("handles empty registrations", async () => {
    await expect(unregisterAllServiceWorkers()).resolves.toBeUndefined();
  });
});

describe("forceVersionReload", () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock, origin: "https://localhost:7777" },
    });
    reloadMock.mockClear();
    vi.mocked(navigator.serviceWorker.getRegistrations).mockResolvedValue([]);
  });

  it("sets reload guard and triggers reload", () => {
    forceVersionReload();

    const guardKey = `cas_reload_${window.location.origin}`;
    expect(localStorage.getItem(guardKey)).not.toBeNull();
  });

  it("does not reload when guard is active", () => {
    const guardKey = `cas_reload_${window.location.origin}`;
    localStorage.setItem(guardKey, String(Date.now()));

    forceVersionReload();

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("allows reload after guard TTL expires", () => {
    const guardKey = `cas_reload_${window.location.origin}`;
    localStorage.setItem(guardKey, String(Date.now() - 31_000));

    forceVersionReload();

    expect(localStorage.getItem(guardKey)).not.toBeNull();
  });
});

describe("registerControllerChangeListener", () => {
  it("adds controllerchange event listener", () => {
    registerControllerChangeListener();

    expect(navigator.serviceWorker.addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
    );
  });
});
