/**
 * Dual-channel mixing hook using Web Audio API.
 *
 * Architecture when mixing is active:
 *   Primary track -> MediaStreamSource -> GainNode A --\
 *                                                       --> MasterGain -> AudioContext.destination
 *   Secondary track -> MediaStreamSource -> GainNode B --/
 *
 * The HTMLAudioElement is paused when mix mode activates (Web Audio
 * takes over audible output). On mix disconnect, HTMLAudioElement
 * resumes as the sole audible path.
 *
 * Equal-power crossfade: gainA = cos(balance * PI/2), gainB = sin(balance * PI/2)
 * This prevents the -3dB volume dip at center that linear crossfade produces.
 *
 * Transport wiring: createRecvTransport returns a bare transport. We MUST wire
 * transport.on("connect") to call peer.request("connectSecondaryTransport", { dtlsParameters })
 * for the DTLS handshake to complete -- without this, WebRTC audio won't flow.
 */

import { useRef, useCallback, useState } from "react";
import { Device, types as mediasoupTypes } from "mediasoup-client";
import type { Peer } from "../lib/signaling-client";
import type { AudioEngine } from "../lib/audio-engine";
import { createRecvTransport, type TransportInfo } from "../lib/mediasoup-device";

interface ConsumeSecondaryResponse {
  transportInfo: TransportInfo;
  consumerId: string;
  producerId: string;
  kind: mediasoupTypes.MediaKind;
  rtpParameters: mediasoupTypes.RtpParameters;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
  latencyMode: string;
  lossRecovery: string;
}

export interface UseMixBalanceResult {
  /** Whether secondary channel is connected and mixing */
  isMixing: boolean;
  /** Current balance: 0 = primary only, 0.5 = equal, 1 = secondary only */
  balance: number;
  /** Channel ID of the secondary mix source */
  secondaryChannelId: string | null;
  /** Connect to a secondary channel for mixing */
  connectSecondary: (
    channelId: string,
    peer: Peer,
    engine: AudioEngine,
    primaryTrack: MediaStreamTrack,
  ) => Promise<void>;
  /** Disconnect secondary (back to single-channel) */
  disconnectSecondary: (peer: Peer, engine: AudioEngine) => void;
  /** Set mix balance (0.0 - 1.0) */
  setBalance: (value: number) => void;
  /** Set master volume for mix mode (0.0 - 1.0) */
  setMasterVolume: (value: number) => void;
}

export function useMixBalance(): UseMixBalanceResult {
  const [isMixing, setIsMixing] = useState(false);
  const [balance, setBalanceState] = useState(0.5);
  const [secondaryChannelId, setSecondaryChannelId] = useState<string | null>(
    null,
  );

  const gainARef = useRef<GainNode | null>(null);
  const gainBRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const sourceARef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sourceBRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const secondaryTransportRef = useRef<mediasoupTypes.Transport | null>(null);
  const secondaryConsumerRef = useRef<mediasoupTypes.Consumer | null>(null);

  const applyBalance = useCallback((bal: number, ctx: AudioContext) => {
    const clampedBalance = Math.max(0, Math.min(1, bal));
    if (gainARef.current) {
      gainARef.current.gain.setTargetAtTime(
        Math.cos(clampedBalance * Math.PI / 2),
        ctx.currentTime,
        0.01,
      );
    }
    if (gainBRef.current) {
      gainBRef.current.gain.setTargetAtTime(
        Math.sin(clampedBalance * Math.PI / 2),
        ctx.currentTime,
        0.01,
      );
    }
  }, []);

  const connectSecondary = useCallback(
    async (
      channelId: string,
      peer: Peer,
      engine: AudioEngine,
      primaryTrack: MediaStreamTrack,
    ): Promise<void> => {
      const ctx = engine.getAudioContext();
      await ctx.resume();

      // 1. Request secondary consumer from server (returns transport params + rtpCapabilities)
      const response = (await peer.request("consumeSecondary", {
        channelId,
      })) as ConsumeSecondaryResponse;

      // 2. Load a device for the secondary router's RTP capabilities.
      //    All routers share identical RTP caps (same mediasoup worker config),
      //    but we must still call device.load() with the secondary router's caps
      //    so the device can validate codec compatibility for consume().
      const secondaryDevice = new Device();
      await secondaryDevice.load({
        routerRtpCapabilities: response.rtpCapabilities,
      });

      // 3. Create secondary recv transport with correct signature: (device, transportInfo)
      const secondaryTransport = createRecvTransport(
        secondaryDevice,
        response.transportInfo,
      );

      // 4. Wire transport "connect" event for DTLS handshake -- WITHOUT THIS, AUDIO WON'T FLOW.
      //    When mediasoup-client needs to establish the DTLS connection, it fires "connect".
      //    We must send dtlsParameters to the server via protoo so it can complete the handshake.
      secondaryTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
        peer
          .request("connectSecondaryTransport", {
            transportId: secondaryTransport.id,
            dtlsParameters,
          })
          .then(callback)
          .catch(errback);
      });

      secondaryTransportRef.current = secondaryTransport;

      // 5. Consume on secondary transport
      const consumer = await secondaryTransport.consume({
        id: response.consumerId,
        producerId: response.producerId,
        kind: response.kind,
        rtpParameters: response.rtpParameters,
      });
      secondaryConsumerRef.current = consumer;

      // 6. Resume secondary consumer on server
      await peer.request("resumeSecondaryConsumer");

      const secondaryTrack = consumer.track;

      // 7. Build Web Audio mixing graph
      const audioElement = engine.getAudioElement();
      audioElement.pause(); // Web Audio takes over

      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      const masterGain = ctx.createGain();

      const sourceA = ctx.createMediaStreamSource(
        new MediaStream([primaryTrack]),
      );
      const sourceB = ctx.createMediaStreamSource(
        new MediaStream([secondaryTrack]),
      );

      sourceA.connect(gainA).connect(masterGain).connect(ctx.destination);
      sourceB.connect(gainB).connect(masterGain);

      gainARef.current = gainA;
      gainBRef.current = gainB;
      masterGainRef.current = masterGain;
      sourceARef.current = sourceA;
      sourceBRef.current = sourceB;

      // Apply initial balance (0.5 = equal)
      applyBalance(0.5, ctx);

      setSecondaryChannelId(channelId);
      setBalanceState(0.5);
      setIsMixing(true);
    },
    [applyBalance],
  );

  const disconnectSecondary = useCallback(
    (peer: Peer, engine: AudioEngine): void => {
      // Tear down Web Audio graph
      sourceARef.current?.disconnect();
      sourceBRef.current?.disconnect();
      gainARef.current?.disconnect();
      gainBRef.current?.disconnect();
      masterGainRef.current?.disconnect();
      sourceARef.current = null;
      sourceBRef.current = null;
      gainARef.current = null;
      gainBRef.current = null;
      masterGainRef.current = null;

      // Close secondary transport/consumer
      if (secondaryConsumerRef.current) {
        secondaryConsumerRef.current.close();
        secondaryConsumerRef.current = null;
      }
      if (secondaryTransportRef.current) {
        secondaryTransportRef.current.close();
        secondaryTransportRef.current = null;
      }

      // Notify server
      peer.request("disconnectSecondary").catch(() => {});

      // Resume HTMLAudioElement for single-channel playback
      const audioElement = engine.getAudioElement();
      audioElement.play().catch(() => {});

      setIsMixing(false);
      setSecondaryChannelId(null);
      setBalanceState(0.5);
    },
    [],
  );

  const setBalance = useCallback(
    (value: number): void => {
      const clamped = Math.max(0, Math.min(1, value));
      setBalanceState(clamped);
      if (gainARef.current && gainBRef.current) {
        const ctx = gainARef.current.context as AudioContext;
        applyBalance(clamped, ctx);
      }
    },
    [applyBalance],
  );

  const setMasterVolume = useCallback((value: number): void => {
    if (masterGainRef.current) {
      const ctx = masterGainRef.current.context as AudioContext;
      masterGainRef.current.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
    }
  }, []);

  return {
    isMixing,
    balance,
    secondaryChannelId,
    connectSecondary,
    disconnectSecondary,
    setBalance,
    setMasterVolume,
  };
}
