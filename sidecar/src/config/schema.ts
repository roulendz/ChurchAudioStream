import { z } from "zod";
import { getDefaultInterface } from "../network/interfaces";

function resolveDefaultHost(): string {
  const defaultInterface = getDefaultInterface();
  return defaultInterface?.address ?? "127.0.0.1";
}

/**
 * Port reserved for the admin loopback HTTP server.
 * Must match ADMIN_LOOPBACK_PORT in server.ts.
 * The HTTPS port cannot be set to this value to avoid a bind collision.
 */
const RESERVED_ADMIN_LOOPBACK_PORT = 7778;

export const ServerSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7777)
    .refine(
      (port) => port !== RESERVED_ADMIN_LOOPBACK_PORT,
      { message: `Port ${RESERVED_ADMIN_LOOPBACK_PORT} is reserved for the admin loopback server` },
    ),
  host: z.string().default(resolveDefaultHost),      // Advertised host (mDNS, cert SANs, display)
  listenHost: z.string().default("0.0.0.0"),          // Actual bind address (all interfaces)
  interface: z.string().optional(),
});

export const MdnsSchema = z.object({
  enabled: z.boolean().default(true),
});

export const HostsFileSchema = z.object({
  enabled: z.boolean().default(true),
});

export const NetworkSchema = z.object({
  domain: z.string().default("church.audio"),
  mdns: MdnsSchema.default(() => MdnsSchema.parse({})),
  hostsFile: HostsFileSchema.default(() => HostsFileSchema.parse({})),
});

export const CertificateSchema = z.object({
  certPath: z.string().default("cert.pem"),
  keyPath: z.string().default("key.pem"),
  caCertPath: z.string().default("ca-cert.pem"),
  caKeyPath: z.string().default("ca-key.pem"),
});

// ---------------------------------------------------------------------------
// Audio capture pipeline schemas
// ---------------------------------------------------------------------------

/** Level metering update frequency for GStreamer `level` element. */
export const LevelMeteringSchema = z.object({
  intervalMs: z.number().int().min(10).max(1000).default(100),
});

/** A source assigned to an app channel with gain, mute, and delay controls. */
export const SourceAssignmentSchema = z.object({
  sourceId: z.string(),
  selectedChannels: z.array(z.number().int().min(0)).min(1),
  gain: z.number().min(0).max(2).default(1.0),
  muted: z.boolean().default(false),
  delayMs: z.number().min(0).max(5000).default(0),
});

// ---------------------------------------------------------------------------
// Audio processing schemas
// ---------------------------------------------------------------------------

/** AGC / loudness normalization settings. Maps to audioloudnorm element. */
export const AgcSchema = z.object({
  enabled: z.boolean().default(true),
  targetLufs: z.number().min(-20).max(-14).default(-16),
  maxTruePeakDbtp: z.number().min(-6).max(0).default(-2),
});

/**
 * Opus encoder settings. Maps to opusenc element.
 * frameSize stored as string enum for JSON serialization; convert to number at pipeline build time.
 */
export const OpusEncodingSchema = z.object({
  enabled: z.boolean().default(true),
  bitrateKbps: z.number().int().min(48).max(192).default(128),
  frameSize: z.enum(["10", "20", "40"]).default("20"),
  fec: z.boolean().default(false),
  bitrateMode: z.enum(["vbr", "cbr"]).default("vbr"),
});

/** RTP/RTCP output port and SSRC assignment. Ports assigned by port-allocator at runtime. */
export const RtpOutputSchema = z.object({
  rtpPort: z.number().int().min(1024).max(65534).default(77702),
  rtcpPort: z.number().int().min(1025).max(65535).default(77703),
  ssrc: z.number().int().min(1).default(1),
});

/** Complete per-channel processing configuration. */
export const ProcessingSchema = z.object({
  mode: z.enum(["speech", "music"]).default("speech"),
  agc: AgcSchema.default(() => AgcSchema.parse({})),
  opus: OpusEncodingSchema.default(() => OpusEncodingSchema.parse({})),
  rtpOutput: RtpOutputSchema.default(() => RtpOutputSchema.parse({})),
});

/** An app-level audio channel (mix bus) persisted in config. */
export const ChannelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  sources: z.array(SourceAssignmentSchema).default([]),
  outputFormat: z.enum(["mono", "stereo"]).default("mono"),
  autoStart: z.boolean().default(true),
  processing: ProcessingSchema.default(() => ProcessingSchema.parse({})),
});

/** Pipeline crash recovery settings. */
export const PipelineRecoverySchema = z.object({
  autoRestart: z.boolean().default(true),
  maxRestartAttempts: z.number().int().min(0).max(20).default(5),
  restartDelayMs: z.number().int().min(500).max(30000).default(2000),
  maxRestartDelayMs: z.number().int().min(1000).max(60000).default(30000),
  drainTimeoutMs: z.number().int().min(0).max(5000).default(500),
});

/** Discovery cache and device polling settings. */
export const DiscoveryCacheSchema = z.object({
  enabled: z.boolean().default(true),
  devicePollIntervalMs: z.number().int().min(1000).max(30000).default(5000),
});

/** Top-level audio configuration grouping channels, metering, recovery, and discovery. */
export const AudioSchema = z.object({
  channels: z.array(ChannelSchema).default([]),
  levelMetering: LevelMeteringSchema.default(() => LevelMeteringSchema.parse({})),
  pipelineRecovery: PipelineRecoverySchema.default(() => PipelineRecoverySchema.parse({})),
  discoveryCache: DiscoveryCacheSchema.default(() => DiscoveryCacheSchema.parse({})),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  server: ServerSchema.default(() => ServerSchema.parse({})),
  network: NetworkSchema.default(() => NetworkSchema.parse({})),
  certificate: CertificateSchema.default(() => CertificateSchema.parse({})),
  audio: AudioSchema.default(() => AudioSchema.parse({})),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
