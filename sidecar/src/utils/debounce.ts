/**
 * Shared debounce utilities for timer-based deferred execution.
 *
 * Provides a reusable pattern for "schedule callback after delay, cancelling
 * any previously scheduled callback for the same key." Used across the codebase
 * for disk persistence, pipeline restarts, and event log flushing.
 */

/**
 * Schedule a debounced callback for a given key.
 *
 * If a timer already exists for the key, it is cleared before setting a new one.
 * When the delay elapses, the callback fires and the timer entry is removed
 * from the map.
 */
export function scheduleDebounced(
  timerMap: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  delayMs: number,
  callback: () => void,
): void {
  clearDebounceTimer(timerMap, key);

  const timer = setTimeout(() => {
    timerMap.delete(key);
    callback();
  }, delayMs);

  timerMap.set(key, timer);
}

/**
 * Clear a single debounce timer for a given key, if one exists.
 */
export function clearDebounceTimer(
  timerMap: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
): void {
  const existing = timerMap.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
    timerMap.delete(key);
  }
}

/**
 * Clear all debounce timers in the map. Used during shutdown.
 */
export function clearAllDebounceTimers(
  timerMap: Map<string, ReturnType<typeof setTimeout>>,
): void {
  for (const timer of timerMap.values()) {
    clearTimeout(timer);
  }
  timerMap.clear();
}
