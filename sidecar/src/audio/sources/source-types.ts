/**
 * Audio source type definitions for AES67 multicast streams and local audio devices.
 *
 * These types represent discovered audio sources that can be assigned to app channels.
 * The discriminated union `DiscoveredSource` allows type-safe handling of both source kinds.
 */

/** Windows audio APIs supported by GStreamer for local device capture. */
export type AudioApi = "wasapi2" | "wasapi" | "asio" | "directsound";

/** GStreamer device class indicating capture direction. */
export type DeviceDirection = "source" | "sink";

/** Lifecycle status of a discovered audio source. */
export type SourceStatus = "available" | "unavailable" | "in-use" | "verifying";

/**
 * A discovered AES67/Dante multicast stream.
 *
 * Populated from SAP announcements with SDP payload parsing.
 * The `id` is derived from multicast address + port to ensure uniqueness.
 */
export interface AES67Source {
  readonly id: string;
  readonly type: "aes67";
  readonly name: string;
  readonly description: string;
  readonly multicastAddress: string;
  readonly port: number;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly channelCount: number;
  readonly payloadType: number;
  readonly originAddress: string;
  readonly channelLabels: string[];
  status: SourceStatus;
  lastSeenAt: number;
  readonly discoveredAt: number;
}

/**
 * A local audio input device discovered via GStreamer device monitor.
 *
 * The `id` is derived from deviceId + api to ensure uniqueness
 * (the same physical device may appear under multiple APIs).
 */
export interface LocalDeviceSource {
  readonly id: string;
  readonly type: "local";
  readonly name: string;
  readonly api: AudioApi;
  readonly deviceId: string;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly channelCount: number;
  readonly isLoopback: boolean;
  /** Device direction: "source" = input mic, "sink" = output/loopback */
  readonly direction: DeviceDirection;
  status: SourceStatus;
  lastSeenAt: number;
}

/**
 * A file-backed test audio source. Loops an MP3/WAV file as if it were a live
 * input, so developers can verify the full capture -> encode -> stream pipeline
 * without real audio hardware.
 *
 * Not produced by `gst-device-monitor`; registered explicitly at startup from
 * `config.audio.testSources`. The `id` follows the pattern `file:{slug}`.
 */
export interface FileSource {
  readonly id: string;
  readonly type: "file";
  readonly name: string;
  readonly filePath: string;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly channelCount: number;
  /** Whether the file should loop indefinitely (default true). */
  readonly loop: boolean;
  status: SourceStatus;
  lastSeenAt: number;
}

/** Union of all discoverable audio source types, discriminated by `type` field. */
export type DiscoveredSource = AES67Source | LocalDeviceSource | FileSource;
