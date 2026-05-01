/**
 * Convert a unix timestamp (seconds) to a human-readable relative string.
 *
 * Tiger-Style: pure function, no clock side-effects (nowMs injected for tests).
 * Returns "never" for missing/zero/negative inputs (defensive — no exception
 * thrown on bad data so the UI degrades gracefully).
 */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
const FUTURE_TOLERANCE_SECONDS = 30;

export function formatRelativeTime(unix: number | undefined, nowMs: number = Date.now()): string {
  if (unix === undefined || unix === 0 || unix < 0) return "never";
  const nowSec = Math.floor(nowMs / 1000);
  const deltaSec = nowSec - unix;
  if (deltaSec < -FUTURE_TOLERANCE_SECONDS) return "in the future";
  if (deltaSec < SECONDS_PER_MINUTE) return "just now";
  if (deltaSec < SECONDS_PER_HOUR) {
    const minutes = Math.floor(deltaSec / SECONDS_PER_MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  if (deltaSec < SECONDS_PER_DAY) {
    const hours = Math.floor(deltaSec / SECONDS_PER_HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (deltaSec < SECONDS_PER_YEAR) {
    const days = Math.floor(deltaSec / SECONDS_PER_DAY);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const years = Math.floor(deltaSec / SECONDS_PER_YEAR);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
