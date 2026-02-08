/**
 * Shared error message extraction utility.
 *
 * Provides a single place for the common pattern of narrowing an unknown
 * catch-block error to a human-readable string.
 */

/**
 * Extract a human-readable message from an unknown error value.
 *
 * Returns `err.message` for Error instances, `String(err)` for everything else.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
