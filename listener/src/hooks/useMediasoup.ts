/**
 * Custom hook managing mediasoup Device, transport, and consumer.
 *
 * Provides connectToChannel() which runs the full signaling handshake:
 * getRouterRtpCapabilities -> createWebRtcTransport -> connectWebRtcTransport
 * -> consume -> resumeConsumer, returning the audio MediaStreamTrack.
 *
 * On peer reconnection (isReconnect flag from useSignaling), resets the
 * cached Device and re-runs the handshake if a channel was active.
 */

import { useRef, useCallback } from "react";
import { types as mediasoupTypes } from "mediasoup-client";
import type { Peer } from "../lib/signaling-client";
import {
  loadDevice,
  createRecvTransport,
  resetDevice,
  type TransportInfo,
} from "../lib/mediasoup-device";

interface ConsumeResponse {
  consumerId: string;
  producerId: string;
  kind: mediasoupTypes.MediaKind;
  rtpParameters: mediasoupTypes.RtpParameters;
  latencyMode: string;
  lossRecovery: string;
}

interface RouterCapabilitiesResponse {
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

export interface UseMediasoupResult {
  /**
   * Run the full signaling handshake for a channel and return the audio track.
   * The caller must call audioEngine.resume() from a user gesture BEFORE
   * calling this, or after receiving the track.
   */
  connectToChannel: (
    channelId: string,
    peer: Peer,
  ) => Promise<MediaStreamTrack>;
  /** Clean disconnect: close transport and consumer. */
  disconnect: () => void;
  /** Reset device on reconnection (WiFi drop recovery). */
  handleReconnect: () => void;
}

export function useMediasoup(): UseMediasoupResult {
  const transportRef = useRef<mediasoupTypes.Transport | null>(null);
  const consumerRef = useRef<mediasoupTypes.Consumer | null>(null);

  const disconnect = useCallback(() => {
    if (consumerRef.current) {
      consumerRef.current.close();
      consumerRef.current = null;
    }
    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }
  }, []);

  const handleReconnect = useCallback(() => {
    disconnect();
    resetDevice();
  }, [disconnect]);

  const connectToChannel = useCallback(
    async (channelId: string, peer: Peer): Promise<MediaStreamTrack> => {
      // Clean up any existing connection
      disconnect();

      // Step 1: Get router RTP capabilities and load Device
      const capResponse = (await peer.request(
        "getRouterRtpCapabilities",
      )) as RouterCapabilitiesResponse;
      const device = await loadDevice(capResponse.rtpCapabilities);

      // Step 2: Create WebRTC receive transport on the server
      const transportInfo = (await peer.request("createWebRtcTransport", {
        rtpCapabilities: device.rtpCapabilities,
        channelId,
      })) as TransportInfo;

      // Step 3: Create local receive transport
      const transport = createRecvTransport(device, transportInfo);
      transportRef.current = transport;

      // Step 4: Wire transport "connect" event for DTLS handshake
      transport.on(
        "connect",
        (
          { dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters },
          callback: () => void,
          errback: (error: Error) => void,
        ) => {
          peer
            .request("connectWebRtcTransport", { dtlsParameters })
            .then(() => callback())
            .catch((error: unknown) =>
              errback(
                error instanceof Error ? error : new Error(String(error)),
              ),
            );
        },
      );

      // Step 5: Consume the channel's audio producer
      const consumeResponse = (await peer.request("consume", {
        channelId,
      })) as ConsumeResponse;

      const consumer = await transport.consume({
        id: consumeResponse.consumerId,
        producerId: consumeResponse.producerId,
        kind: consumeResponse.kind,
        rtpParameters: consumeResponse.rtpParameters,
      });
      consumerRef.current = consumer;

      // Step 6: Resume consumer (server starts sending RTP)
      await peer.request("resumeConsumer");

      return consumer.track;
    },
    [disconnect],
  );

  return { connectToChannel, disconnect, handleReconnect };
}
