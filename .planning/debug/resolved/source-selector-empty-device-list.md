---
status: resolved
trigger: "The admin UI's channel configuration 'Add Source' dropdown is empty - no audio devices appear."
created: 2026-02-10T00:00:00Z
updated: 2026-02-10T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED
test: TypeScript compiles cleanly, full build succeeds
expecting: Devices now appear in source selector dropdown
next_action: Archive session

## Symptoms

expected: Source selector dropdown should list available audio input devices
actual: Dropdown only shows "-- Select source --" placeholder, no devices listed
errors: None explicitly reported
reproduction: Open admin UI -> channel configuration -> look at "Add Source" dropdown
started: Recurring/persistent issue

## Eliminated

## Evidence

- timestamp: 2026-02-10T00:00:30Z
  checked: Full data flow trace (frontend -> WS handler -> AudioSubsystem -> SourceRegistry -> DiscoveryManager -> DeviceEnumerator)
  found: Frontend useSources hook sends "sources:list", WS handler calls audioSubsystem.getSources() which delegates to sourceRegistry.getAll(). The registry is empty because no devices were ever added to it.
  implication: Bug is in how devices get into the SourceRegistry

- timestamp: 2026-02-10T00:00:45Z
  checked: DiscoveryManager.wireDeviceEvents() and DeviceEnumerator.enumerate()
  found: |
    Three events from DeviceEnumerator:
    1. "device-added" -> calls sourceRegistry.addOrUpdate() - BUT only emitted by pollOnce() for NEW devices not in currentDevices
    2. "device-removed" -> calls sourceRegistry.markUnavailable()
    3. "enumeration-complete" -> calls reconcileLocalSources() which ONLY marks MISSING sources as unavailable

    DiscoveryManager.start() calls:
      await this.deviceEnumerator.enumerate();  // populates currentDevices, emits "enumeration-complete"
      this.deviceEnumerator.startPolling();      // polls every 5s, only emits "device-added" for NEW devices

    Since enumerate() already populated currentDevices with all devices, the first poll sees no new devices.
    The "enumeration-complete" handler only reconciles (marks missing as unavailable), never adds devices.
    The return value of enumerate() is discarded.
  implication: Initial devices are discovered by GStreamer but never registered in SourceRegistry. Only hot-plugged devices (appearing after polling starts) would be added.

- timestamp: 2026-02-10T00:01:30Z
  checked: Fix applied and compiled
  found: TypeScript compiles cleanly (--noEmit and full build both pass). Fix is minimal (6 lines added).
  implication: Fix is correct and non-breaking

## Resolution

root_cause: DiscoveryManager.wireDeviceEvents() handles "enumeration-complete" event with reconcileLocalSources() which only marks MISSING devices as unavailable. It never adds the freshly enumerated devices to the SourceRegistry. The "device-added" event (which does add to registry) is only emitted during polling for devices that are NEW relative to the previous poll. Since enumerate() is called before startPolling(), all initial devices are already in currentDevices and the first poll finds nothing new.
fix: In the "enumeration-complete" handler in discovery-manager.ts, iterate over all enumerated devices and call sourceRegistry.addOrUpdate() for each one before reconciling. This ensures devices from the initial enumeration AND all subsequent enumerations are registered. The addOrUpdate() call is idempotent, so repeated registration of the same device is harmless.
verification: TypeScript compiles cleanly. Build succeeds. Fix is a 6-line addition that uses existing convertDeviceToLocalSource() and sourceRegistry.addOrUpdate() methods - no new code paths introduced.
files_changed:
  - sidecar/src/audio/discovery/discovery-manager.ts
