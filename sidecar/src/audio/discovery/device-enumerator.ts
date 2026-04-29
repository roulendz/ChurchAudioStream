import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { logger } from "../../utils/logger.js";
import { toErrorMessage } from "../../utils/error-message.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AudioApi = "wasapi2" | "wasapi" | "asio" | "directsound";

/** GStreamer device class indicating capture direction. */
export type DeviceDirection = "source" | "sink";

export interface EnumeratedDevice {
  /** Unique composite key: `${api}:${deviceId}` */
  id: string;
  /** Human-readable display name (e.g. "Focusrite USB Audio") */
  name: string;
  /** Windows audio API that exposes this device */
  api: AudioApi;
  /** API-specific identifier used by GStreamer to open the device */
  deviceId: string;
  /** Native/default sample rate in Hz (0 if unknown) */
  sampleRate: number;
  /** Bit depth (16, 24, 32) derived from audio format string (0 if unknown) */
  bitDepth: number;
  /** Number of input channels (0 if unknown) */
  channelCount: number;
  /** True for WASAPI loopback (system audio output capture) */
  isLoopback: boolean;
  /** True for Bluetooth devices (used for filtering — never returned to callers) */
  isBluetooth: boolean;
  /** Device direction: "source" = input (microphone), "sink" = output (speaker/loopback) */
  direction: DeviceDirection;
}

/** Events emitted by DeviceEnumerator. */
export interface DeviceEnumeratorEvents {
  "device-added": (device: EnumeratedDevice) => void;
  "device-removed": (deviceId: string) => void;
  "enumeration-complete": (devices: EnumeratedDevice[]) => void;
  "error": (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Parsed device block from gst-device-monitor plain-text output
// ---------------------------------------------------------------------------

interface GstMonitorDevice {
  name: string;
  deviceClass: string;
  caps: string;
  properties: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GST_DEVICE_MONITOR_BIN = "gst-device-monitor-1.0";
const EXEC_TIMEOUT_MS = 10_000;

const BLUETOOTH_NAME_PATTERNS = [/bluetooth/i, /\bbt\b/i];
const BLUETOOTH_PATH_PATTERNS = [/BTH/i, /Bluetooth/i];
const LOOPBACK_NAME_PATTERNS = [/loopback/i, /monitor/i];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the audio API from the device properties `device.api` field.
 * Returns `undefined` for unrecognised APIs (they are skipped).
 */
function detectApi(props: Record<string, string>): AudioApi | undefined {
  const api = (props["device.api"] ?? "").toLowerCase();

  if (api === "wasapi2") return "wasapi2";
  if (api === "wasapi") return "wasapi";
  if (api.includes("asio")) return "asio";
  if (api.includes("directsound")) return "directsound";

  return undefined;
}

/**
 * Extract the API-specific device identifier from device properties.
 *
 * - wasapi2     → device.id     (Windows endpoint GUID or path)
 * - ASIO        → device.clsid  (COM CLSID)
 * - DirectSound → device.guid   (DirectSound GUID)
 */
function extractDeviceId(api: AudioApi, props: Record<string, string>): string {
  switch (api) {
    case "wasapi2":
      return props["device.id"] ?? "";
    case "wasapi":
      return props["device.strid"] ?? "";
    case "asio":
      return props["device.clsid"] ?? "";
    case "directsound":
      return props["device.guid"] ?? "";
  }
}

/** Streaming target sample rate -- preferred whenever a source's caps allow it. */
const PREFERRED_SAMPLE_RATE = 48000;

/** Cap on what we treat as a "real" sample rate when caps report a wide range (DirectSound's `[1, INT_MAX]`). */
const MAX_REASONABLE_SAMPLE_RATE = 192000;

/** Cap on channel count to filter out absurd caps (single-value devices reporting wide ranges). */
const MAX_REASONABLE_CHANNEL_COUNT = 64;

/**
 * Extract the raw value substring of a GStreamer caps field.
 *
 * GStreamer caps fields take one of these shapes:
 *   single:  rate=48000           or  rate=(int)48000
 *   range:   rate=[ 8000, 192000 ]
 *   list:    rate={ 44100, 48000, 96000 }
 *   list:    rate=< 44100, 48000 >
 *
 * Returns the captured value substring (e.g. `"[ 8000, 192000 ]"`) or null
 * if the field is absent. The optional `(int)` type qualifier is consumed
 * but not part of the returned substring.
 */
function extractCapsFieldValue(capsEntry: string, fieldName: string): string | null {
  const fieldValuePattern = new RegExp(
    `${fieldName}=(?:\\([^)]*\\))?\\s*(\\d+|\\[[^\\]]*\\]|\\{[^}]*\\}|<[^>]*>)`,
  );
  const fieldMatch = capsEntry.match(fieldValuePattern);
  return fieldMatch ? fieldMatch[1] : null;
}

/** Parse all integers out of a caps field's value substring. */
function parseIntegersFromFieldValue(fieldValue: string): number[] {
  const integerMatches = fieldValue.match(/\d+/g);
  if (!integerMatches) return [];
  return integerMatches.map((s) => parseInt(s, 10));
}

/**
 * Extract the highest integer value from a GStreamer caps numeric field,
 * clamped to a sensible upper bound.
 *
 * - Range form `[min, max]`: returns max, clamped to `maxAllowed`.
 * - List form `{a,b,c}` / `<a,b,c>`: returns max, clamped to `maxAllowed`.
 * - Single value: returned as-is, clamped to `maxAllowed`.
 *
 * Returns 0 if the field is absent or contains no parseable integers.
 *
 * Clamping is required because some GStreamer plugins (notably DirectSound)
 * report ranges like `[1, INT_MAX]` for unrestricted fields, which is not
 * a meaningful upper bound for downstream pipeline configuration.
 */
function extractMaxIntegerFromCapsField(
  capsEntry: string,
  fieldName: string,
  maxAllowed: number,
): number {
  const fieldValue = extractCapsFieldValue(capsEntry, fieldName);
  if (fieldValue === null) return 0;

  const values = parseIntegersFromFieldValue(fieldValue);
  if (values.length === 0) return 0;

  return Math.min(Math.max(...values), maxAllowed);
}

/**
 * Extract a streaming-friendly sample rate from a GStreamer caps `rate=...` field.
 *
 * Returns `PREFERRED_SAMPLE_RATE` (48 kHz) whenever the device's caps allow it,
 * since the streaming pipeline targets 48 kHz Opus and avoiding a resample at
 * the source eliminates one stage of jitter and CPU.
 *
 * Falls back to the max value in the caps, clamped to `MAX_REASONABLE_SAMPLE_RATE`,
 * because some plugins (DirectSound) report `[1, INT_MAX]` for unrestricted ranges.
 *
 * Returns 0 if the field is absent or contains no parseable integers.
 */
function extractSampleRateFromCapsField(capsEntry: string): number {
  const fieldValue = extractCapsFieldValue(capsEntry, "rate");
  if (fieldValue === null) return 0;

  const values = parseIntegersFromFieldValue(fieldValue);
  if (values.length === 0) return 0;

  if (preferredRateIsSupported(fieldValue, values, PREFERRED_SAMPLE_RATE)) {
    return PREFERRED_SAMPLE_RATE;
  }

  return Math.min(Math.max(...values), MAX_REASONABLE_SAMPLE_RATE);
}

/**
 * Decide whether the preferred rate is "supported" given the caps field shape:
 * - Range form (substring starts with `[` and exactly 2 integers): preferred is in [min, max].
 * - List form: preferred appears in the list.
 * - Single value: preferred equals the value.
 */
function preferredRateIsSupported(
  fieldValue: string,
  values: number[],
  preferred: number,
): boolean {
  const isRange = fieldValue.startsWith("[") && values.length === 2;
  if (isRange) {
    const [min, max] = values;
    return preferred >= min && preferred <= max;
  }
  return values.includes(preferred);
}

/**
 * Parse the first `audio/x-raw` caps entry for sample rate, format, and channels.
 */
function parseCaps(capsString: string | undefined): {
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
} {
  const result = { sampleRate: 0, bitDepth: 0, channelCount: 0 };
  if (!capsString) return result;

  // Caps may contain multiple entries separated by ';'.  Take the first audio/x-raw one.
  const rawEntry = capsString
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("audio/x-raw"));
  if (!rawEntry) return result;

  result.sampleRate = extractSampleRateFromCapsField(rawEntry);
  result.channelCount = extractMaxIntegerFromCapsField(
    rawEntry,
    "channels",
    MAX_REASONABLE_CHANNEL_COUNT,
  );

  const formatMatch = rawEntry.match(/format=\(?(\w+)/);
  if (formatMatch) {
    result.bitDepth = formatStringToBitDepth(formatMatch[1]);
  }

  return result;
}

/** Map GStreamer audio format names to bit depth. */
function formatStringToBitDepth(format: string): number {
  switch (format.toUpperCase()) {
    case "S8":
    case "U8":
      return 8;
    case "S16LE":
    case "S16BE":
    case "U16LE":
    case "U16BE":
      return 16;
    case "S24LE":
    case "S24BE":
    case "S24_32LE":
    case "S24_32BE":
      return 24;
    case "S32LE":
    case "S32BE":
    case "U32LE":
    case "U32BE":
    case "F32LE":
    case "F32BE":
      return 32;
    case "F64LE":
    case "F64BE":
      return 64;
    default:
      return 0;
  }
}

/** Check whether a device is Bluetooth based on its name or path. */
function isBluetooth(name: string, props: Record<string, string>): boolean {
  if (BLUETOOTH_NAME_PATTERNS.some((re) => re.test(name))) return true;

  const devicePath = props["device.path"] ?? "";
  const deviceId = props["device.id"] ?? "";

  return (
    BLUETOOTH_PATH_PATTERNS.some((re) => re.test(devicePath)) ||
    BLUETOOTH_PATH_PATTERNS.some((re) => re.test(deviceId))
  );
}

/** Derive the device direction from the GStreamer class string. */
function deriveDirection(deviceClass: string): DeviceDirection {
  // GStreamer class: "Audio/Source" = input mic, "Audio/Sink" = output speaker
  if (deviceClass.toLowerCase().includes("sink")) return "sink";
  return "source";
}

/** Check whether a WASAPI device is a loopback (output monitor) device. */
function isLoopbackDevice(
  api: AudioApi,
  name: string,
  props: Record<string, string>,
): boolean {
  if (api !== "wasapi2") return false;

  // Explicit property check (plain-text output always gives string values)
  if (props["wasapi2.device.loopback"] === "true") return true;

  // Name-based heuristic
  return LOOPBACK_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Parse gst-device-monitor-1.0 plain-text output into device blocks.
 *
 * Each block looks like:
 * ```
 * Device found:
 *     name  : Some Device Name
 *     class : Audio/Source
 *     caps  : audio/x-raw, format=F32LE, ...
 *     properties:
 *         device.api = wasapi2
 *         device.id = {GUID}
 *     gst-launch-1.0 ...
 * ```
 */
function parseDeviceMonitorOutput(stdout: string): GstMonitorDevice[] {
  const blocks = stdout.split(/^Device found:\s*$/m).slice(1);
  const devices: GstMonitorDevice[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());

    let name = "";
    let deviceClass = "";
    let caps = "";
    const properties: Record<string, string> = {};
    let inProperties = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and gst-launch suggestion lines
      if (!trimmed || trimmed.startsWith("gst-launch-1.0")) {
        inProperties = false;
        continue;
      }

      if (inProperties) {
        const eqIndex = trimmed.indexOf(" = ");
        if (eqIndex !== -1) {
          const key = trimmed.slice(0, eqIndex).trim();
          const value = trimmed.slice(eqIndex + 3).trim();
          properties[key] = value;
        }
        continue;
      }

      if (trimmed.startsWith("name")) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) name = trimmed.slice(colonIdx + 1).trim();
      } else if (trimmed.startsWith("class")) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) deviceClass = trimmed.slice(colonIdx + 1).trim();
      } else if (trimmed.startsWith("caps")) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) caps = trimmed.slice(colonIdx + 1).trim();
      } else if (trimmed === "properties:") {
        inProperties = true;
      }
    }

    if (name) {
      devices.push({ name, deviceClass, caps, properties });
    }
  }

  return devices;
}

/**
 * Run `gst-device-monitor-1.0` with the given device class filter and parse
 * plain-text output into `EnumeratedDevice[]`.
 *
 * Note: GStreamer 1.26 does NOT support `-f json`. The `-f` flag means
 * `--follow` (continuous monitoring mode). We run without it so the
 * process lists devices once and exits.
 *
 * @param deviceClass  "Audio/Source" for inputs, "Audio/Sink" for outputs
 */
function runDeviceMonitor(deviceClass: string): Promise<EnumeratedDevice[]> {
  return new Promise((resolve) => {
    execFile(
      GST_DEVICE_MONITOR_BIN,
      [deviceClass],
      { timeout: EXEC_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          const isNotFound =
            (error as NodeJS.ErrnoException).code === "ENOENT" ||
            (stderr ?? "").includes("is not recognized");

          if (isNotFound) {
            logger.error(
              "GStreamer not found. Install GStreamer 1.26 and add to PATH.",
            );
            resolve([]);
            return;
          }

          logger.warn("gst-device-monitor-1.0 failed", {
            code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
            message: error.message,
          });
          resolve([]);
          return;
        }

        const trimmed = (stdout ?? "").trim();
        if (!trimmed) {
          logger.debug("gst-device-monitor-1.0 returned empty output", { deviceClass });
          resolve([]);
          return;
        }

        const rawDevices = parseDeviceMonitorOutput(trimmed);
        resolve(mapRawDevices(rawDevices));
      },
    );
  });
}

/**
 * Convert parsed GStreamer device blocks to typed EnumeratedDevice array.
 *
 * Prefers wasapi2 entries for richer metadata (sample rate, channel count, bit depth)
 * but falls back to wasapi v1 endpoint IDs for pipeline construction when the wasapi2
 * device ID uses the long `\\?\SWD#MMDEVAPI#...` path that gst-launch-1.0 cannot handle
 * (GStreamer issue #922). Each device is deduplicated by display name so the same
 * physical device is not listed multiple times across APIs.
 */
function mapRawDevices(rawDevices: GstMonitorDevice[]): EnumeratedDevice[] {
  // Phase 1: Build a lookup from device display name to wasapi v1 endpoint ID.
  // The wasapi v1 device.strid uses {flow}.{GUID} format which wasapisrc accepts.
  const wasapiV1EndpointByName = new Map<string, string>();
  for (const raw of rawDevices) {
    const api = detectApi(raw.properties);
    if (api !== "wasapi") continue;
    const strid = raw.properties["device.strid"] ?? "";
    if (strid) {
      wasapiV1EndpointByName.set(raw.name, strid);
    }
  }

  // Phase 2: Build the result set from wasapi2, asio, and directsound entries.
  // Skip wasapi v1 entries -- they are only used for endpoint ID lookup above.
  // Also skip directsound when a wasapi2 entry for the same device exists (dedup).
  const results: EnumeratedDevice[] = [];
  const seenNames = new Set<string>();

  for (const raw of rawDevices) {
    const api = detectApi(raw.properties);
    if (!api || api === "wasapi") continue; // Skip wasapi v1 entries and unknown APIs

    // Deduplicate: same device appears under wasapi2 AND directsound.
    // Prefer wasapi2 for richer metadata; skip directsound duplicates.
    if (api === "directsound" && seenNames.has(raw.name)) continue;
    seenNames.add(raw.name);

    let deviceId = extractDeviceId(api, raw.properties);
    let effectiveApi: AudioApi = api;

    // CRITICAL FIX: wasapi2src cannot open non-default devices via gst-launch-1.0
    // because the long device path \\?\SWD#MMDEVAPI#... has escaping issues
    // (GStreamer issue #922). For these devices, use wasapisrc (v1) with the
    // simpler {flow}.{GUID} endpoint ID format that works reliably.
    if (api === "wasapi2" && isLongDevicePath(deviceId)) {
      const v1Endpoint = wasapiV1EndpointByName.get(raw.name);
      if (v1Endpoint) {
        deviceId = v1Endpoint;
        effectiveApi = "wasapi";
      }
      // If no v1 endpoint found, keep the wasapi2 ID and hope for the best.
      // This can happen for loopback-only devices that don't have a wasapi v1 entry.
    }

    const { sampleRate, bitDepth, channelCount } = parseCaps(raw.caps);
    const bluetoothFlag = isBluetooth(raw.name, raw.properties);
    const loopbackFlag = isLoopbackDevice(api, raw.name, raw.properties);
    const direction = deriveDirection(raw.deviceClass);

    results.push({
      id: `${effectiveApi}:${deviceId}`,
      name: raw.name,
      api: effectiveApi,
      deviceId,
      sampleRate,
      bitDepth,
      channelCount,
      isLoopback: loopbackFlag,
      isBluetooth: bluetoothFlag,
      direction,
    });
  }

  return results;
}

/**
 * Check whether a WASAPI2 device ID uses the long path format that
 * gst-launch-1.0 cannot handle. Short GUID format like `{GUID}` works fine;
 * long paths like `\\?\SWD#MMDEVAPI#...` do not.
 */
function isLongDevicePath(deviceId: string): boolean {
  return deviceId.includes("SWD#") || deviceId.includes("SWD\\");
}

// ---------------------------------------------------------------------------
// DeviceEnumerator
// ---------------------------------------------------------------------------

export class DeviceEnumerator extends EventEmitter {
  private currentDevices = new Map<string, EnumeratedDevice>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private running = false;

  constructor(pollIntervalMs = 5_000) {
    super();
    this.pollIntervalMs = pollIntervalMs;
  }

  // -- Public API -----------------------------------------------------------

  /**
   * One-shot enumeration of audio input devices.
   * Runs `gst-device-monitor-1.0 Audio/Source`, parses plain-text output,
   * filters Bluetooth, and returns the result.
   */
  async enumerate(): Promise<EnumeratedDevice[]> {
    const allDevices = await runDeviceMonitor("Audio/Source");

    if (allDevices.length === 0 && this.currentDevices.size === 0) {
      // Possibly GStreamer is missing — check explicitly
      const testResult = await runDeviceMonitor("Audio/Source");
      if (testResult.length === 0) {
        this.emit(
          "error",
          new Error("GStreamer not found. Install GStreamer 1.26 and add to PATH."),
        );
      }
    }

    // Bluetooth devices are flagged but no longer filtered out.
    // Originally excluded due to latency concerns, but users may want them
    // for testing or as fallback inputs.
    const filtered = allDevices;

    // Update internal map
    this.currentDevices = new Map(filtered.map((d) => [d.id, d]));

    this.emit("enumeration-complete", filtered);
    logger.info("Device enumeration complete", {
      sourceDeviceCount: filtered.length,
      apis: [...new Set(filtered.map((d) => d.api))],
    });

    return filtered;
  }

  /**
   * Enumerate audio output (sink) devices.
   * Used by the audio monitor feature so the admin can route sources to a
   * specific output for listening verification.
   */
  async enumerateOutputDevices(): Promise<EnumeratedDevice[]> {
    const allDevices = await runDeviceMonitor("Audio/Sink");

    logger.info("Output device enumeration complete", {
      sinkDeviceCount: allDevices.length,
    });

    return allDevices;
  }

  /**
   * Start periodic polling for hot-plug detection.
   * Compares each poll result with the previous device list and emits
   * `device-added` / `device-removed` events for differences.
   */
  startPolling(): void {
    if (this.running) return;
    this.running = true;

    logger.info("Device polling started", { intervalMs: this.pollIntervalMs });

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /** Stop polling for hot-plug detection. */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    logger.info("Device polling stopped");
  }

  /** Return a snapshot of all currently known (non-Bluetooth) input devices. */
  getCurrentDevices(): EnumeratedDevice[] {
    return Array.from(this.currentDevices.values());
  }

  /** Lookup a single device by its composite id (`api:deviceId`). */
  getDeviceById(id: string): EnumeratedDevice | undefined {
    return this.currentDevices.get(id);
  }

  // -- Internals ------------------------------------------------------------

  /**
   * Run one poll cycle: enumerate devices, diff against previous snapshot,
   * emit add/remove events for any changes.
   */
  private async pollOnce(): Promise<void> {
    try {
      const freshDevices = await runDeviceMonitor("Audio/Source");
      const freshMap = new Map(freshDevices.map((d) => [d.id, d]));

      // Detect added devices (in fresh but not in current)
      for (const [id, device] of freshMap) {
        if (!this.currentDevices.has(id)) {
          logger.info("Audio device added", { id, name: device.name, api: device.api });
          this.emit("device-added", device);
        }
      }

      // Detect removed devices (in current but not in fresh)
      for (const [id, device] of this.currentDevices) {
        if (!freshMap.has(id)) {
          logger.info("Audio device removed", { id, name: device.name, api: device.api });
          this.emit("device-removed", id);
        }
      }

      this.currentDevices = freshMap;
    } catch (err) {
      const message = toErrorMessage(err);
      logger.warn("Device polling error (will retry next interval)", { error: message });
      this.emit("error", err instanceof Error ? err : new Error(message));
      // Do NOT stop polling on transient errors
    }
  }
}
