/**
 * GStreamer level metering bus message parser.
 *
 * Parses audio level data from GStreamer `level` element messages that appear
 * on stdout when `gst-launch-1.0` is run with the `-m` flag (bus messages).
 *
 * Pure function module -- no side effects, no state, no I/O.
 * The process manager uses `createBusMessageLineParser` to process
 * raw stdout output from GStreamer child processes.
 *
 * Handles multiple GStreamer output formats:
 *   Double single:      peak=(double)-12.5
 *   Double multi:       peak=(double){ -12.5, -14.2 }
 *   GValueArray single: peak=(GValueArray)< -90.308 >
 *   GValueArray multi:  peak=(GValueArray)< -12.5, -14.2 >
 *
 * Also handles -inf (silence) which parseFloat naturally converts to -Infinity.
 */

import type { AudioLevels } from "./pipeline-types.js";

/** Clipping threshold in dB. Any peak at or above this triggers clipping detection. */
const CLIPPING_THRESHOLD_DB = -0.1;

/**
 * Regex to identify lines containing GStreamer level element messages.
 * Level messages contain "level," followed by key-value fields.
 */
const LEVEL_LINE_PATTERN = /\blevel,/;

/**
 * Build a regex to extract values from a GStreamer level field.
 *
 * Supports both type annotation formats:
 *   (double)   -- GStreamer < 1.26:  peak=(double)-12.5  or  peak=(double){ -12.5, -14.2 }
 *   (GValueArray) -- GStreamer 1.26: peak=(GValueArray)< -90.308 >  or  peak=(GValueArray)< -12.5, -14.2 >
 *
 * The regex uses `\([^)]+\)` to match any type annotation in parentheses,
 * then optionally matches `{` or `<` delimiters around the value list.
 */
function buildFieldPattern(fieldName: string): RegExp {
  return new RegExp(
    `${fieldName}=\\([^)]+\\)[{<]?\\s*([^;>}]+?)\\s*[>}]?(?:,\\s*(?:\\w+=|$)|;|$)`,
  );
}

const PEAK_PATTERN = buildFieldPattern("peak");
const RMS_PATTERN = buildFieldPattern("rms");
const DECAY_PATTERN = buildFieldPattern("decay");

/**
 * Parse a comma-separated list of GStreamer double values.
 * Handles regular numbers, scientific notation, and `-inf`.
 *
 * parseFloat("-inf") returns -Infinity natively in JavaScript.
 */
function parseDoubleList(raw: string): number[] {
  return raw
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const value = parseFloat(segment);
      return isNaN(value) ? Number.NEGATIVE_INFINITY : value;
    });
}

/**
 * Determine if any channel peak is at or above the clipping threshold.
 */
function detectClipping(peakValues: number[]): boolean {
  return peakValues.some(
    (peak) => isFinite(peak) && peak >= CLIPPING_THRESHOLD_DB,
  );
}

/**
 * Parse a single line of GStreamer bus message output for level metering data.
 *
 * Returns an `AudioLevels` object if the line is a level message,
 * or `null` for non-level lines (debug output, state changes, errors, etc.).
 *
 * @param line - A single line from gst-launch-1.0 -m stdout output
 * @returns Parsed audio levels or null if line is not a level message
 */
export function parseMeteringLine(line: string): AudioLevels | null {
  if (!LEVEL_LINE_PATTERN.test(line)) {
    return null;
  }

  const peakMatch = line.match(PEAK_PATTERN);
  const rmsMatch = line.match(RMS_PATTERN);

  // A valid level message must have at least peak and rms
  if (!peakMatch || !rmsMatch) {
    return null;
  }

  const peak = parseDoubleList(peakMatch[1]);
  const rms = parseDoubleList(rmsMatch[1]);

  // Decay is optional -- some GStreamer versions omit it
  const decayMatch = line.match(DECAY_PATTERN);
  const decay = decayMatch ? parseDoubleList(decayMatch[1]) : [];

  return {
    peak,
    rms,
    decay,
    timestamp: Date.now(),
    clipping: detectClipping(peak),
  };
}

/**
 * Convert a dB value to a normalized 0.0-1.0 range for display purposes.
 *
 * Uses the standard dB-to-linear conversion: 10^(dB/20)
 * - 0 dB maps to 1.0 (full scale)
 * - -60 dB maps to ~0.001 (effectively silent)
 * - -Infinity maps to 0.0 (true silence)
 *
 * @param db - Audio level in dB (0 dB = full scale)
 * @returns Normalized value clamped to [0.0, 1.0]
 */
export function dbToNormalized(db: number): number {
  if (!isFinite(db) || db <= -60) {
    return 0;
  }
  return Math.max(0, Math.min(1, Math.pow(10, db / 20)));
}

/**
 * GStreamer error/warning patterns that should be forwarded to the error callback.
 * Checked as defense-in-depth on stdout bus messages (errors normally go to stderr).
 */
const GSTREAMER_ERROR_PATTERN = /\b(?:ERROR|WARN|WARNING|CRITICAL)\b/i;

/**
 * Create a streaming line-by-line parser for GStreamer bus message output.
 *
 * Returns a function that accepts raw Buffer chunks from the child process stdout
 * (where `gst-launch-1.0 -m` outputs bus messages including level data).
 * Chunks are accumulated and split on newlines, handling partial lines across chunk
 * boundaries. Complete lines are parsed for level data or error messages.
 *
 * This design prevents buffer overflow (Pitfall 5 from research):
 * lines are processed immediately as they arrive, never accumulating unbounded data.
 *
 * @param onLevels - Called with parsed AudioLevels for each level message
 * @param onError - Called with the raw line for GStreamer error/warning messages (defense-in-depth)
 * @returns A function to pass stdout Buffer chunks to
 */
export function createBusMessageLineParser(
  onLevels: (levels: AudioLevels) => void,
  onError: (line: string) => void,
): (chunk: Buffer) => void {
  let partialLine = "";

  return (chunk: Buffer): void => {
    const text = partialLine + chunk.toString("utf-8");
    const lines = text.split("\n");

    // Last element is either empty (if chunk ended with \n) or a partial line
    partialLine = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd(); // Remove \r on Windows
      if (line.length === 0) continue;

      const levels = parseMeteringLine(line);
      if (levels) {
        onLevels(levels);
        continue;
      }

      if (GSTREAMER_ERROR_PATTERN.test(line)) {
        onError(line);
      }
    }
  };
}
