import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift-Tab focus inside `containerRef` while `active` is true.
 * On deactivation (active flips false OR component unmounts), returns focus
 * to the element that had focus when the trap activated.
 *
 * Tiger-Style: descriptive names, no magic strings outside the constant
 * above, single-responsibility (DOES NOT manage open/close state — caller
 * passes `active` derived from feature state).
 *
 * @remarks
 * Focusable elements snapshot at activation. Do NOT mount/unmount focusable
 * children while the trap is active — Tab cycling will use the stale list.
 * Phase 4 trap activates only during `Installing` (no buttons rendered) so
 * this is harmless. If you need dynamic focusables, replace the snapshot
 * with a `MutationObserver` query in the keydown handler.
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
