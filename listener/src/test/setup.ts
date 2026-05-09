/// <reference types="vitest/globals" />

/**
 * Vitest setup — polyfills for jsdom missing APIs.
 */

// jsdom does not implement matchMedia. Provide a minimal stub.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom does not implement navigator.serviceWorker. Provide a minimal stub.
if (!("serviceWorker" in navigator)) {
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(navigator, "serviceWorker", {
    writable: true,
    value: {
      ready: Promise.resolve({}),
      controller: null,
      getRegistrations: vi.fn().mockResolvedValue([]),
      register: vi.fn().mockResolvedValue({}),
      addEventListener: vi.fn((event: string, cb: EventListener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: EventListener) => {
        listeners.get(event)?.delete(cb);
      }),
    },
  });
}
