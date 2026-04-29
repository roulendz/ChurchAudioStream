---
status: verifying
trigger: "device-list-regression: source selector dropdown empty, previous debug session added incorrect fix to discovery-manager.ts"
created: 2026-02-10T00:00:00Z
updated: 2026-02-10T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED -- TWO latent bugs (not a regression) cause empty device list. All fixes applied and type-checked.
test: TypeScript compilation passes for both frontend and sidecar.
expecting: Device list should now populate on connection and update as devices enumerate.
next_action: Verify by building/running the app, or mark as resolved after user confirms.

## Symptoms

expected: Source selector dropdown should list discovered audio devices (previously showed devices with "verifying" status)
actual: Dropdown is completely empty, only shows "-- Select source --" placeholder, Add Source button disabled
errors: None explicitly reported
reproduction: Open admin UI -> channel configuration -> observe empty Add Source dropdown
started: Broke within last ~10 commits. Was working before (devices showed as "verifying")

## Eliminated

- hypothesis: A specific recent commit introduced a regression that broke device listing
  evidence: Examined all 15 recent commits. None changed the device-to-frontend data flow. discovery-manager.ts, device-enumerator.ts, source-registry.ts unchanged since their creation commits (404bab3, 1cbb05c, abd1a4d). The useSources hook (8303eb5) and SourceSelector (d370040) have always had the same design.
  timestamp: 2026-02-10T00:01:00Z

- hypothesis: The previous debug session's fix to discovery-manager.ts (adding device registration in enumeration-complete handler) was incorrect
  evidence: The fix was actually addressing a REAL bug (Bug #1 below). It was not incorrect. The initial enumeration NEVER registered devices in the source registry -- only the disk cache provided them. The fix correctly adds registration.
  timestamp: 2026-02-10T00:01:00Z

## Evidence

- timestamp: 2026-02-10T00:00:10Z
  checked: git log -15 and git show --stat for all recent commits
  found: No commit in the last 15 changed discovery-manager.ts, device-enumerator.ts, source-registry.ts, or the core data flow for sources
  implication: The bug is NOT a regression from a recent commit

- timestamp: 2026-02-10T00:00:20Z
  checked: Committed wireDeviceEvents() in discovery-manager.ts (from original commit 404bab3 to HEAD)
  found: "enumeration-complete" handler has ALWAYS only called reconcileLocalSources(). It never called addOrUpdate() for enumerated devices. "device-added" only fires in pollOnce() for NEW devices not already in currentDevices. Since enumerate() populates currentDevices before polling starts, initial devices never emit "device-added".
  implication: Bug #1: Initial device enumeration NEVER registers devices in the source registry. Only the disk cache provides them.

- timestamp: 2026-02-10T00:00:30Z
  checked: useSources hook (committed version at 8303eb5) + useWebSocket timing
  found: useSources calls sendMessage("sources:list") in useEffect on mount. But useWebSocket.connect() is async -- WebSocket is in CONNECTING state when the effect runs. sendMessage() checks readyState !== OPEN and silently drops the message. The initial request ALWAYS fails.
  implication: Bug #2: The initial sources:list request is always silently dropped.

- timestamp: 2026-02-10T00:00:40Z
  checked: How sources:changed events propagate from SourceRegistry -> AudioSubsystem -> WS broadcast -> useSources
  found: The only way the frontend gets sources (since initial request fails) is via "sources:changed" subscription. This fires only when SourceRegistry.addOrUpdate/updateStatus/markUnavailable/remove is called. On startup, reconcileLocalSources only fires this if a cached source is ABSENT from fresh enumeration.
  implication: The "previously working" state was a fragile race: it only worked when at least one cached source was missing from fresh enumeration, triggering markUnavailable -> sources:changed -> client re-request.

- timestamp: 2026-02-10T00:00:50Z
  checked: Startup sequence in index.ts
  found: Server starts listening (line 216) BEFORE audioSubsystem.start() (line 243). SourceRegistry cache is loaded in constructor (line 200). So cached sources exist when clients connect, but no events fire to notify the client.
  implication: Client connects, subscribes, but initial sendMessage drops. If no sources:changed fires, UI stays empty forever.

- timestamp: 2026-02-10T00:00:55Z
  checked: Uncommitted changes to all 4 originally-modified files
  found: discovery-manager.ts has device registration in enumeration-complete (fixes Bug #1). useSources.ts has welcome event subscriber with retry (fixes Bug #2). device-enumerator.ts removes Bluetooth filtering. source-registry.ts adds statusChanged check in addOrUpdate.
  implication: The uncommitted changes to discovery-manager.ts and useSources.ts are both CORRECT fixes. They should be KEPT, not reverted.

- timestamp: 2026-02-10T00:01:10Z
  checked: useChannels.ts for the same timing bug
  found: useChannels has the identical mount-time sendMessage("channels:list") that fires before WS connects. Same silent drop issue.
  implication: Applied the same "welcome" event subscriber pattern to useChannels.ts for consistency.

- timestamp: 2026-02-10T00:01:20Z
  checked: useSources.ts setTimeout cleanup
  found: The 3-second retry setTimeout in the welcome handler was not cleaned up on unmount. Could fire after component unmounts.
  implication: Added proper cleanup (clearTimeout in useEffect return).

- timestamp: 2026-02-10T00:01:30Z
  checked: TypeScript compilation for frontend and sidecar
  found: Both compile cleanly with no errors.
  implication: All changes are type-safe.

## Resolution

root_cause: TWO latent bugs (present since initial implementation, NOT a regression from any recent commit):

  Bug #1 (Backend - discovery-manager.ts): Initial device enumeration via "enumeration-complete" event only reconciled (marked absent devices unavailable) but NEVER registered discovered devices in the source registry via addOrUpdate(). The "device-added" event only fires during pollOnce() for NEW devices, but enumerate() populates currentDevices before polling starts, so initial devices never trigger "device-added". Devices only appeared in the registry from the disk cache (discovered-sources.json). On first run or after cache deletion, no devices would ever appear.

  Bug #2 (Frontend - useSources.ts, useChannels.ts): Both hooks call sendMessage() in useEffect on mount, but the WebSocket is still in CONNECTING state at that point (connection is async). sendMessage() silently drops messages when readyState !== OPEN. The hooks subscribe to "sources:changed" / channel events for incremental updates, but those only fire when data actually changes on the server. If no changes happen after connection, the frontend stays empty forever.

  Bug #3 (Backend - source-registry.ts): The hasSourceChanged() comparator intentionally excluded status changes. When devices loaded from cache (status: "verifying") were re-registered by the enumeration-complete fix with status "available", the status transition was not detected, so "source-updated" events were not emitted and the frontend did not learn about the status change.

  The user's "previously working" state was a fragile race condition: it only worked when (a) a disk cache existed with devices, (b) at least one cached device was absent from the current enumeration, triggering markUnavailable() -> "sources-changed" -> client re-request. This was never reliable.

fix:
  1. discovery-manager.ts: Register ALL enumerated devices via addOrUpdate() in the "enumeration-complete" handler (before reconciliation). This ensures the source registry is populated on initial startup, not just from cache.
  2. useSources.ts: Subscribe to "welcome" event and re-request sources:list when connection is established. Added 3-second delayed retry for late-arriving devices (audio subsystem starts after WS server). Added proper setTimeout cleanup.
  3. useChannels.ts: Same "welcome" event pattern as useSources -- re-request channels:list after WS connects.
  4. source-registry.ts: Added statusChanged detection in addOrUpdate() so "verifying" -> "available" transitions emit "source-updated" events.
  5. device-enumerator.ts: Removed Bluetooth device filtering (feature change, not bug fix).
  6. port-allocator.ts: Changed RTP_BASE_PORT from 77702 to 50702 (77702 exceeds UDP max 65535 -- separate bug fix already present in uncommitted changes).

verification: TypeScript compilation passes for both frontend (tsconfig.json) and sidecar (sidecar/tsconfig.json) with zero errors. Full runtime verification requires starting the sidecar and admin UI.

files_changed:
  - sidecar/src/audio/discovery/discovery-manager.ts (Bug #1 fix)
  - src/hooks/useSources.ts (Bug #2 fix + cleanup)
  - src/hooks/useChannels.ts (Bug #2 fix -- same pattern)
  - sidecar/src/audio/sources/source-registry.ts (Bug #3 fix)
  - sidecar/src/audio/discovery/device-enumerator.ts (Bluetooth filter removal)
  - sidecar/src/audio/processing/port-allocator.ts (RTP port fix)
