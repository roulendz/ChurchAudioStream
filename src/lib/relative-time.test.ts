import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

describe("formatRelativeTime", () => {
  it("returns 'never' for undefined", () => {
    expect(formatRelativeTime(undefined, NOW_MS)).toBe("never");
  });
  it("returns 'never' for zero", () => {
    expect(formatRelativeTime(0, NOW_MS)).toBe("never");
  });
  it("returns 'never' for negative", () => {
    expect(formatRelativeTime(-1, NOW_MS)).toBe("never");
  });
  it("returns 'in the future' for ts > nowSec + 30s tolerance", () => {
    expect(formatRelativeTime(NOW_SEC + 60, NOW_MS)).toBe("in the future");
  });
  it("returns 'just now' for ts within 30s of future tolerance", () => {
    expect(formatRelativeTime(NOW_SEC + 10, NOW_MS)).toBe("just now");
  });
  it("returns 'just now' for 0..59 seconds ago", () => {
    expect(formatRelativeTime(NOW_SEC - 5, NOW_MS)).toBe("just now");
    expect(formatRelativeTime(NOW_SEC - 59, NOW_MS)).toBe("just now");
  });
  it("returns '1 minute ago' at exact 60s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 60, NOW_MS)).toBe("1 minute ago");
  });
  it("returns 'N minutes ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 120, NOW_MS)).toBe("2 minutes ago");
    expect(formatRelativeTime(NOW_SEC - 59 * 60, NOW_MS)).toBe("59 minutes ago");
  });
  it("returns '1 hour ago' at exact 3600s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 3600, NOW_MS)).toBe("1 hour ago");
  });
  it("returns 'N hours ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 2 * 3600, NOW_MS)).toBe("2 hours ago");
    expect(formatRelativeTime(NOW_SEC - 23 * 3600, NOW_MS)).toBe("23 hours ago");
  });
  it("returns '1 day ago' at exact 86400s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 86_400, NOW_MS)).toBe("1 day ago");
  });
  it("returns 'N days ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 3 * 86_400, NOW_MS)).toBe("3 days ago");
    expect(formatRelativeTime(NOW_SEC - 364 * 86_400, NOW_MS)).toBe("364 days ago");
  });
  it("returns '1 year ago' at exact 365-day boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 365 * 86_400, NOW_MS)).toBe("1 year ago");
  });
  it("returns 'N years ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 730 * 86_400, NOW_MS)).toBe("2 years ago");
  });
  it("uses Date.now() when nowMs not supplied (default arg branch)", () => {
    expect(formatRelativeTime(0)).toBe("never");
  });
});
