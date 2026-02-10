/**
 * Simple toast notification component.
 *
 * Positioned at the bottom center of the screen, auto-dismisses after
 * 3 seconds. Used for feedback like "This channel is not live right now".
 */

import { useEffect } from "react";

/** Auto-dismiss duration in milliseconds. */
const TOAST_DISMISS_MS = 3000;

interface ToastProps {
  message: string;
  visible: boolean;
  onHide: () => void;
}

export function Toast({ message, visible, onHide }: ToastProps) {
  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      onHide();
    }, TOAST_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div className="toast" role="alert" aria-live="polite">
      <span className="toast__message">{message}</span>
    </div>
  );
}
