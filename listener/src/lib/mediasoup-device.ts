/**
 * mediasoup-client Device singleton and receive transport factory.
 *
 * Manages the mediasoup Device lifecycle: loads once per session with
 * router RTP capabilities, creates receive transports from server-provided
 * params, and resets on reconnection after WiFi drops.
 *
 * SRP: This module owns Device + Transport creation only. Event wiring
 * (transport "connect" callback) is done by the caller (useMediasoup hook)
 * because it requires the signaling peer for the DTLS handshake.
 */

import { Device, types as mediasoupTypes } from "mediasoup-client";

/** Server-provided transport parameters from createWebRtcTransport response. */
export interface TransportInfo {
  id: string;
  iceParameters: mediasoupTypes.IceParameters;
  iceCandidates: mediasoupTypes.IceCandidate[];
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

let cachedDevice: Device | null = null;

/**
 * Load a mediasoup Device with the router's RTP capabilities.
 * Caches the device instance -- only loads once per session unless
 * resetDevice() is called (reconnection after WiFi drop).
 */
export async function loadDevice(
  rtpCapabilities: mediasoupTypes.RtpCapabilities,
): Promise<Device> {
  if (cachedDevice?.loaded) {
    return cachedDevice;
  }

  const device = new Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  cachedDevice = device;
  return device;
}

/**
 * Create a receive transport from server-provided parameters.
 *
 * Returns the transport without wiring the "connect" event. The caller
 * must wire it with the signaling peer for the DTLS handshake:
 *
 *   transport.on("connect", ({ dtlsParameters }, callback, errback) => { ... })
 */
export function createRecvTransport(
  device: Device,
  transportInfo: TransportInfo,
): mediasoupTypes.Transport {
  return device.createRecvTransport({
    id: transportInfo.id,
    iceParameters: transportInfo.iceParameters,
    iceCandidates: transportInfo.iceCandidates,
    dtlsParameters: transportInfo.dtlsParameters,
  });
}

/**
 * Clear the cached Device instance.
 * Called on reconnection after WiFi drop so the next connectToChannel
 * call re-runs the full handshake with fresh router capabilities.
 */
export function resetDevice(): void {
  cachedDevice = null;
}
