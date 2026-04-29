---
status: resolved
trigger: "Device list shows mixed input/output devices; no audio level indicator; pipeline crashes with Failed to open device for NVIDIA Broadcast mic"
created: 2026-02-10T00:00:00Z
updated: 2026-02-10T02:00:00Z
---

## Current Focus

hypothesis: ALL THREE ROOT CAUSES CONFIRMED AND FIXED
test: End-to-end verification complete
expecting: N/A
next_action: Archive and commit

## Symptoms

expected:
1. Source dropdown should separate/label input devices (mics) vs output devices (speakers)
2. Audio input level indicator (VU meter) when source is active
3. Starting channel with "Microphone (NVIDIA Broadcast) (WASAPI)" should work

actual:
1. All devices in flat dropdown with no input/output distinction
2. Generic dropdown, no audio feedback
3. Pipeline crashes immediately with "Failed to open device" error

errors:
- gstwasapi2ringbuffer.cpp(352): gst_wasapi2_ring_buffer_post_open_error
- Failed to open device
- Failed to set pipeline to PAUSED
- Exit code 42

reproduction:
1. Open admin UI, source dropdown shows all devices mixed
2. Start channel "latvian" with source "Microphone (NVIDIA Broadcast) (WASAPI)" — crashes

started: Current state after previous debug session fixed empty device list

## Eliminated

- hypothesis: NVIDIA Broadcast mic specifically is broken
  evidence: ALL non-default WASAPI2 devices fail. FrontMic Realtek, Virtual Audio Cable, etc. all crash with same error. Only default device GUID format works.
  timestamp: 2026-02-10T00:30:00Z

- hypothesis: Wrong escaping in quoteDeviceId function
  evidence: Even GStreamer's own suggested escaped format from gst-device-monitor fails. The issue is fundamental to wasapi2src CLI device path handling.
  timestamp: 2026-02-10T00:35:00Z

## Evidence

- timestamp: 2026-02-10T00:10:00Z
  checked: GstMonitorDevice parsing in device-enumerator.ts
  found: The parser does NOT extract the "class" field (Audio/Source vs Audio/Sink). The GstMonitorDevice interface has name, caps, properties but no class.
  implication: No way to distinguish input vs output devices in the data model

- timestamp: 2026-02-10T00:15:00Z
  checked: EnumeratedDevice interface and SourceSelector component
  found: No "direction" or "deviceClass" field in EnumeratedDevice, LocalDeviceSource, or DiscoveredSource. SourceSelector groups by type (AES67 vs Local) but not by direction.
  implication: Issue 1 root cause confirmed -- class info is available from GStreamer but never captured

- timestamp: 2026-02-10T00:20:00Z
  checked: VuMeter, VuMeterBank components
  found: VuMeter component EXISTS and works well (canvas-based, 60fps). VuMeterBank shows meters for streaming channels. The issue is that the SourceSelector/ChannelConfigPanel doesn't show any level info before a channel starts streaming.
  implication: Issue 2 is a UX enhancement -- VU meters exist but only appear for active channels, not in the source selector dropdown. Not a bug per se.

- timestamp: 2026-02-10T00:25:00Z
  checked: gst-launch-1.0 wasapi2src with default device GUID
  found: Default device with GUID format {2EEF81BE-...} works fine
  implication: wasapi2src works, but only with short GUID format

- timestamp: 2026-02-10T00:30:00Z
  checked: gst-launch-1.0 wasapi2src with non-default device long path
  found: ALL non-default devices fail. The long path \\?\SWD#MMDEVAPI#... never works with gst-launch-1.0 CLI, even with GStreamer's own suggested escaping.
  implication: Known GStreamer issue #922 -- device-monitor prints incorrect/unusable CLI strings

- timestamp: 2026-02-10T00:35:00Z
  checked: gst-launch-1.0 wasapisrc with endpoint ID
  found: wasapisrc (v1) works perfectly with {flow}.{GUID} format for ALL devices
  implication: Solution: extract endpoint ID from wasapi2 device path, use wasapisrc for non-default devices

- timestamp: 2026-02-10T00:40:00Z
  checked: discovered-sources.json
  found: 22 sources registered. Mix of WASAPI2 sources and loopback sources, all labeled isLoopback correctly but no input/output direction info.
  implication: isLoopback partially addresses the problem (loopback = output capture) but true input vs output distinction is missing

- timestamp: 2026-02-10T01:30:00Z
  checked: Post-fix enumeration and pipeline test
  found: 7 input devices + 10 loopback devices correctly separated. NVIDIA Broadcast now uses wasapi api with endpoint ID {0.0.1.00000000}.{9590b9b1-...}. Pipeline works via Node.js spawn with shell:true.
  implication: All three issues resolved

## Resolution

root_cause:
1. ISSUE 1 (mixed devices): device-enumerator.ts parses "name", "caps", "properties" but skips "class" field from GStreamer output. The "class" field contains "Audio/Source" (input) or "Audio/Sink" (output) which is the definitive direction indicator. This info never reaches the frontend.
2. ISSUE 2 (no level indicator): VuMeter exists and works for streaming channels. No level indicator in the source selector dropdown is expected (Phase 6 feature territory). Not a bug.
3. ISSUE 3 (pipeline crash): wasapi2src CANNOT open non-default devices via gst-launch-1.0 CLI due to GStreamer bug #922 with device path escaping. The long device.id path from wasapi2 device monitor is unusable. Solution: use wasapisrc (v1) for non-default WASAPI devices, which works with the simpler {flow}.{endpoint-GUID} format.

fix:
1. ISSUE 1: Added "class" field parsing in parseDeviceMonitorOutput(), DeviceDirection type, direction field in EnumeratedDevice/LocalDeviceSource. Updated SourceSelector to group by "Input Devices (Microphones)" / "Loopback (System Audio)" / "Output Devices".
2. ISSUE 2: No fix needed -- VuMeter already exists for active channels. This is by-design Phase 6 behavior.
3. ISSUE 3: Added wasapi v1 API support throughout the pipeline. Device enumerator now recognizes wasapi v1 entries (device.strid) and falls back to them for non-default wasapi2 devices with long paths. Pipeline builder has new wasapiV1SourceHead using wasapisrc element. Deduplication between wasapi2/directsound APIs preserves richer metadata.

verification:
- TypeScript compilation: zero errors in both sidecar and frontend
- Device enumeration: 7 input + 10 loopback devices correctly separated
- NVIDIA Broadcast mic: api=wasapi, deviceId={0.0.1.00000000}.{9590b9b1-...}
- Pipeline test: wasapisrc with NVIDIA Broadcast endpoint works via gst-launch-1.0 CLI
- Pipeline test: wasapisrc with NVIDIA Broadcast endpoint works via Node.js spawn with shell:true
- Pipeline builder: produces correct `wasapisrc device="..."` string for wasapi API

files_changed:
- sidecar/src/audio/discovery/device-enumerator.ts: Added class parsing, direction field, wasapi v1 support, long-path detection, smart API fallback
- sidecar/src/audio/sources/source-types.ts: Added DeviceDirection type, direction field to LocalDeviceSource, wasapi to AudioApi union
- sidecar/src/audio/discovery/discovery-manager.ts: Pass direction in convertDeviceToLocalSource, added wasapi display name
- sidecar/src/audio/sources/source-registry.ts: Include direction in change detection
- sidecar/src/audio/pipeline/pipeline-builder.ts: Added wasapiV1SourceHead builder, updated dispatch table
- src/hooks/useSources.ts: Added wasapi to AudioApi, DeviceDirection type, direction field
- src/components/channels/SourceSelector.tsx: Grouping by direction (Input/Loopback/Output)
