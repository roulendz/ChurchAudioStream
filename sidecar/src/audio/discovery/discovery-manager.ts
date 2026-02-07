import { SapListener } from "./sap-listener.js";
import { DeviceEnumerator, type EnumeratedDevice } from "./device-enumerator.js";
import { SourceRegistry } from "../sources/source-registry.js";
import type { AES67Source, LocalDeviceSource, AudioApi } from "../sources/source-types.js";
import type { Aes67SdpInfo } from "./sdp-parser.js";
import { logger } from "../../utils/logger.js";
import Bonjour from "bonjour-service";

/** Human-readable display names for Windows audio APIs. */
const API_DISPLAY_NAMES: Record<string, string> = {
  wasapi2: "WASAPI",
  asio: "ASIO",
  directsound: "DirectSound",
};

/** Return a user-friendly display name for a Windows audio API. */
function apiDisplayName(api: string): string {
  return API_DISPLAY_NAMES[api] ?? api;
}

/** Build a deterministic source ID for an AES67 stream. */
function buildAes67SourceId(originAddress: string, originSessionId: string): string {
  return `aes67:${originAddress}:${originSessionId}`;
}

/** Build a deterministic source ID for a local audio device. */
function buildLocalSourceId(api: string, deviceId: string): string {
  return `local:${api}:${deviceId}`;
}

/** Options for configuring the DiscoveryManager. */
interface DiscoveryManagerOptions {
  /** Local IP address for SAP multicast membership. Omit for OS default. */
  networkInterfaceAddress?: string;
  /** Device polling interval in ms (default: 5000). */
  devicePollIntervalMs?: number;
}

/**
 * Coordinates all audio source discovery mechanisms into a unified SourceRegistry.
 *
 * Discovery mechanisms:
 * 1. SAP listener  -- AES67/Dante multicast stream announcements
 * 2. mDNS browser  -- RAVENNA device discovery (supplementary to SAP)
 * 3. Device enumerator -- Local audio input devices via GStreamer
 *
 * SAP is the primary mechanism for AES67 stream discovery. mDNS finds RAVENNA
 * devices but does not create sources without SDP (SAP provides the SDP).
 * Device enumeration handles local audio hardware with hot-plug detection.
 */
export class DiscoveryManager {
  private readonly sapListener: SapListener;
  private readonly deviceEnumerator: DeviceEnumerator;
  private readonly sourceRegistry: SourceRegistry;
  private readonly networkInterfaceAddress: string | undefined;
  private bonjourInstance: Bonjour | null = null;
  private mdnsBrowser: ReturnType<Bonjour["find"]> | null = null;
  private running = false;

  /**
   * Reverse map from SAP stream key to source ID.
   * Needed because SAP deletion packets only carry (sapHash, originAddress),
   * not the full origin session ID required to build the source ID.
   */
  private sapHashToSourceId = new Map<string, string>();

  constructor(sourceRegistry: SourceRegistry, options: DiscoveryManagerOptions = {}) {
    this.sourceRegistry = sourceRegistry;
    this.networkInterfaceAddress = options.networkInterfaceAddress;

    this.sapListener = new SapListener();
    this.deviceEnumerator = new DeviceEnumerator(options.devicePollIntervalMs);

    this.wireSapEvents();
    this.wireDeviceEvents();
  }

  // -- Public API -----------------------------------------------------------

  /** Start all discovery mechanisms (SAP, mDNS, device polling). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 1. Start SAP listener for AES67 stream discovery
    this.sapListener.start(this.networkInterfaceAddress);

    // 2. Start mDNS browser for RAVENNA device discovery
    this.startMdnsBrowser();

    // 3. Run initial device enumeration, then start polling
    await this.deviceEnumerator.enumerate();
    this.deviceEnumerator.startPolling();

    logger.info("Discovery manager started: SAP + mDNS + device polling");
  }

  /** Stop all discovery mechanisms and release resources. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.sapListener.stop();
    this.stopMdnsBrowser();
    this.deviceEnumerator.stopPolling();

    logger.info("Discovery manager stopped");
  }

  /** Return the source registry instance (for other managers to subscribe). */
  getSourceRegistry(): SourceRegistry {
    return this.sourceRegistry;
  }

  // -- SAP event wiring -----------------------------------------------------

  /** Wire SAP listener events to source registry operations. */
  private wireSapEvents(): void {
    this.sapListener.on(
      "stream-discovered",
      (info: Aes67SdpInfo & { sapHash: number }) => {
        const source = this.convertSdpToAes67Source(info);
        this.trackSapStream(info.sapHash, info.originAddress, source.id);
        this.sourceRegistry.addOrUpdate(source);
      },
    );

    this.sapListener.on(
      "stream-updated",
      (info: Aes67SdpInfo & { sapHash: number }) => {
        const source = this.convertSdpToAes67Source(info);
        this.trackSapStream(info.sapHash, info.originAddress, source.id);
        this.sourceRegistry.addOrUpdate(source);
      },
    );

    this.sapListener.on(
      "stream-removed",
      (sapHash: number, originAddress: string) => {
        const lookupKey = `${sapHash}:${originAddress}`;
        const sourceId = this.sapHashToSourceId.get(lookupKey);

        if (sourceId) {
          this.sourceRegistry.remove(sourceId);
          this.sapHashToSourceId.delete(lookupKey);
          logger.info("AES67 source removed from registry", { sourceId });
        } else {
          logger.warn("SAP stream-removed for unknown stream", {
            sapHash,
            originAddress,
          });
        }
      },
    );

    this.sapListener.on("error", (error: Error) => {
      logger.error("SAP listener error", { error: error.message });
    });
  }

  /** Convert parsed SDP info into a typed AES67Source for the registry. */
  private convertSdpToAes67Source(info: Aes67SdpInfo & { sapHash: number }): AES67Source {
    const nowMs = Date.now();
    const sourceId = buildAes67SourceId(info.originAddress, info.originSessionId);

    // Preserve discoveredAt if the source already exists
    const existing = this.sourceRegistry.getById(sourceId);

    return {
      id: sourceId,
      type: "aes67",
      name: info.sessionName,
      description: info.description,
      multicastAddress: info.multicastAddress,
      port: info.port,
      sampleRate: info.sampleRate,
      bitDepth: info.bitDepth,
      channelCount: info.channelCount,
      payloadType: info.payloadType,
      originAddress: info.originAddress,
      channelLabels: info.channelLabels,
      status: "available",
      lastSeenAt: nowMs,
      discoveredAt: existing?.type === "aes67" ? existing.discoveredAt : nowMs,
    };
  }

  /**
   * Track the mapping from SAP (hash + origin) to source ID.
   * Needed for stream-removed events which only carry hash + origin.
   */
  private trackSapStream(sapHash: number, originAddress: string, sourceId: string): void {
    const lookupKey = `${sapHash}:${originAddress}`;
    this.sapHashToSourceId.set(lookupKey, sourceId);
  }

  // -- Device event wiring --------------------------------------------------

  /** Wire device enumerator events to source registry operations. */
  private wireDeviceEvents(): void {
    this.deviceEnumerator.on("device-added", (device: EnumeratedDevice) => {
      const source = this.convertDeviceToLocalSource(device);
      this.sourceRegistry.addOrUpdate(source);
    });

    this.deviceEnumerator.on("device-removed", (compositeId: string) => {
      // compositeId is already "${api}:${deviceId}", prefix with "local:"
      const sourceId = `local:${compositeId}`;
      this.sourceRegistry.markUnavailable(sourceId);
    });

    this.deviceEnumerator.on(
      "enumeration-complete",
      (devices: EnumeratedDevice[]) => {
        this.reconcileLocalSources(devices);
      },
    );

    this.deviceEnumerator.on("error", (error: Error) => {
      logger.error("Device enumerator error", { error: error.message });
    });
  }

  /** Convert an enumerated device into a typed LocalDeviceSource for the registry. */
  private convertDeviceToLocalSource(device: EnumeratedDevice): LocalDeviceSource {
    const nowMs = Date.now();
    return {
      id: buildLocalSourceId(device.api, device.deviceId),
      type: "local",
      name: `${device.name} (${apiDisplayName(device.api)})`,
      api: device.api,
      deviceId: device.deviceId,
      sampleRate: device.sampleRate,
      bitDepth: device.bitDepth,
      channelCount: device.channelCount,
      isLoopback: device.isLoopback,
      status: "available",
      lastSeenAt: nowMs,
    };
  }

  /**
   * Reconcile local device sources after a full enumeration.
   *
   * For each device in the fresh enumeration, update lastSeenAt.
   * For any local source in the registry that is NOT in the fresh list,
   * mark it unavailable (device was unplugged or disappeared).
   */
  private reconcileLocalSources(freshDevices: EnumeratedDevice[]): void {
    const freshIds = new Set(
      freshDevices.map((d) => buildLocalSourceId(d.api, d.deviceId)),
    );

    const registeredLocalSources = this.sourceRegistry.getByType("local");

    for (const source of registeredLocalSources) {
      if (!freshIds.has(source.id) && source.status !== "unavailable") {
        this.sourceRegistry.markUnavailable(source.id);
      }
    }
  }

  // -- mDNS (RAVENNA) discovery ---------------------------------------------

  /** Start mDNS browser for RAVENNA session discovery. */
  private startMdnsBrowser(): void {
    try {
      this.bonjourInstance = new Bonjour();

      // Browse for RAVENNA session services (standard mDNS/DNS-SD service type)
      this.mdnsBrowser = this.bonjourInstance.find(
        { type: "ravenna-session", subtypes: [], protocol: "tcp" },
        (service) => {
          logger.info("RAVENNA device discovered via mDNS", {
            name: service.name,
            host: service.host,
            port: service.port,
            addresses: service.addresses,
          });
          // mDNS discovery is supplementary to SAP. We log the device but do
          // NOT create a source entry because we need the full SDP info
          // (sample rate, channels, multicast address) which only SAP provides.
          // Future enhancement: fetch SDP via RTSP from the RAVENNA device.
        },
      );

      logger.info("mDNS browser started for RAVENNA devices");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to start mDNS browser (non-fatal)", { error: message });
      // mDNS failure is non-fatal: SAP is the primary discovery mechanism
    }
  }

  /** Stop mDNS browser and clean up bonjour instance. */
  private stopMdnsBrowser(): void {
    if (this.mdnsBrowser) {
      this.mdnsBrowser.stop();
      this.mdnsBrowser = null;
    }

    if (this.bonjourInstance) {
      this.bonjourInstance.destroy();
      this.bonjourInstance = null;
    }
  }
}
