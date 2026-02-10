---
status: diagnosed
trigger: "stopped channels disappear from listener channel list instead of showing as dimmed offline cards"
created: 2026-02-10T00:00:00Z
updated: 2026-02-10T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - Server only sends channels that have active mediasoup routers; stopped channels have their routers removed so they vanish from the list entirely
test: Traced full chain from channel:stop -> streaming-subsystem -> router-manager -> signaling-handler -> listener
expecting: Found the exact mechanism
next_action: Report root cause

## Symptoms

expected: Stopped channels appear as dimmed cards with aria-disabled="true", tapping shows toast
actual: Stopped channels disappear entirely, showing empty state "Please be patient while we connect translators"
errors: None reported
reproduction: Stop a channel via admin WS (channel:stop), observe listener UI
started: Unknown

## Eliminated

- hypothesis: Listener React code filters out stopped/offline channels
  evidence: ChannelListView.tsx renders ALL channels passed to it. ChannelCard.tsx correctly handles offline state with channel-card--offline class, aria-disabled, and overlay. useChannelList.ts sorts live first but keeps offline channels. The listener-side code is correct.
  timestamp: 2026-02-10T00:01:00Z

## Evidence

- timestamp: 2026-02-10T00:00:30Z
  checked: RouterManager.getActiveChannelList() (router-manager.ts lines 222-251)
  found: This method iterates ONLY over this.channels Map entries, which are channels with active mediasoup routers. It does NOT consult AudioSubsystem for all known channels.
  implication: Only channels with active routers appear in the list sent to listeners.

- timestamp: 2026-02-10T00:00:35Z
  checked: StreamingSubsystem.handleChannelStateChange() (streaming-subsystem.ts lines 568-618)
  found: When status is "stopped", "error", or "crashed", the code (1) calls disconnectListenersFromChannel, (2) calls routerManager.removeChannelRouter(channelId), (3) calls pushActiveChannelList(). Step 2 removes the channel from the router map. Step 3 then pushes the list which no longer includes the stopped channel.
  implication: The stopped channel's router is deleted BEFORE the updated list is pushed, so it's gone.

- timestamp: 2026-02-10T00:00:40Z
  checked: SignalingHandler.disconnectListenersFromChannel() (signaling-handler.ts lines 349-378)
  found: Sends "channelStopped" notification with remainingChannels that explicitly FILTERS OUT the stopped channel: `enrichedChannels.filter((ch) => ch.id !== channelId)`.
  implication: Even the channelStopped notification sent to listeners on that channel excludes the stopped channel.

- timestamp: 2026-02-10T00:00:45Z
  checked: useChannelList.ts "channelStopped" handler (lines 76-88)
  found: The hook correctly marks the stopped channel as hasActiveProducer=false in local state. BUT this is only applied if the channel already exists in the channels array. The subsequent "activeChannels" notification (from pushActiveChannelList) REPLACES the entire channel list with one that doesn't include the stopped channel.
  implication: Even though the channelStopped handler preserves the channel, the follow-up activeChannels broadcast overwrites it.

- timestamp: 2026-02-10T00:00:50Z
  checked: Listener peer connect flow (signaling-handler.ts line 190)
  found: On initial connect, buildEnrichedChannelList() -> routerManager.getActiveChannelList() is called. This only returns channels with active routers.
  implication: New listeners connecting after a channel stop also never see the stopped channel.

## Resolution

root_cause: Server-side RouterManager.getActiveChannelList() only includes channels with active mediasoup routers. When a channel is stopped, its router is removed (streaming-subsystem.ts line 613), and the subsequent pushActiveChannelList() sends a list that excludes the stopped channel. The listener UI correctly handles offline channels, but the server never sends them.
fix:
verification:
files_changed: []
