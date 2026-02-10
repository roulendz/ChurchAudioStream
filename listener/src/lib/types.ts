/**
 * Shared type definitions for the listener PWA.
 *
 * These types mirror the server-side ListenerChannelInfo from
 * sidecar/src/streaming/streaming-types.ts. Defined locally to
 * avoid cross-project imports.
 */

/** Channel info pushed from the server via protoo notifications. */
export interface ListenerChannelInfo {
  readonly id: string;
  readonly name: string;
  readonly outputFormat: "mono" | "stereo";
  readonly defaultChannel: boolean;
  readonly hasActiveProducer: boolean;
  readonly latencyMode: "live" | "stable";
  readonly lossRecovery: "nack" | "plc";
  readonly description: string;
  readonly language: {
    readonly code: string;
    readonly label: string;
    readonly flag: string;
  };
  readonly listenerCount: number;
  readonly displayToggles: {
    readonly showDescription: boolean;
    readonly showListenerCount: boolean;
    readonly showLiveBadge: boolean;
  };
}
