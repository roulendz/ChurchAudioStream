/**
 * App channel type definitions for audio routing and mixing.
 *
 * An AppChannel represents a logical audio output (e.g., "English", "Spanish")
 * that receives audio from one or more SourceAssignments. Each assignment
 * references a DiscoveredSource by ID and includes per-source gain, mute, and delay.
 */

import type { ProcessingConfig } from "../processing/processing-types.js";

/** Output format for an app channel. */
export type ChannelOutputFormat = "mono" | "stereo";

/** Lifecycle status of an app channel's pipeline. */
export type ChannelStatus = "stopped" | "starting" | "streaming" | "error" | "crashed";

/**
 * A source assigned to an app channel.
 *
 * References a DiscoveredSource by ID and specifies which channels
 * to capture, with per-source gain, mute, and delay for time-alignment.
 */
export interface SourceAssignment {
  readonly sourceId: string;
  readonly selectedChannels: number[];
  gain: number;
  muted: boolean;
  delayMs: number;
}

/**
 * An app-level audio channel (mix bus).
 *
 * Admin creates channels, assigns sources, and configures output format.
 * Each channel runs an independent GStreamer pipeline for fault isolation.
 */
export interface AppChannel {
  readonly id: string;
  name: string;
  sources: SourceAssignment[];
  outputFormat: ChannelOutputFormat;
  autoStart: boolean;
  status: ChannelStatus;
  /** Per-channel audio processing configuration (AGC, Opus, RTP output, mode). */
  processing: ProcessingConfig;
  readonly createdAt: number;
}
