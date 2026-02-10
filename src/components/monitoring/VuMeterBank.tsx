/**
 * Grid of VuMeter components, one per active channel.
 *
 * Filters to channels that are streaming or starting and have recent
 * level data. Shows an empty state message when no channels are active.
 */

import { useCallback } from "react";
import { VuMeter } from "./VuMeter";
import type { UseAudioLevelsReturn } from "../../hooks/useAudioLevels";

interface ChannelInfo {
  id: string;
  name: string;
  status: string;
}

interface VuMeterBankProps {
  channels: ChannelInfo[];
  audioLevels: UseAudioLevelsReturn;
}

/** Only show meters for channels that are active or starting up. */
const METERED_STATUSES = new Set(["streaming", "starting"]);

export function VuMeterBank({ channels, audioLevels }: VuMeterBankProps) {
  const meteredChannels = channels.filter(
    (ch) => METERED_STATUSES.has(ch.status),
  );

  if (meteredChannels.length === 0) {
    return (
      <div className="vu-meter-bank-empty">
        No active channels. Start a channel to see audio levels.
      </div>
    );
  }

  return (
    <div className="vu-meter-bank">
      {meteredChannels.map((channel) => (
        <VuMeterItem
          key={channel.id}
          channelId={channel.id}
          channelName={channel.name}
          getLevels={audioLevels.getLevels}
        />
      ))}
    </div>
  );
}

/** Wrapper that binds getLevels to a specific channelId for the VuMeter. */
function VuMeterItem({
  channelId,
  channelName,
  getLevels,
}: {
  channelId: string;
  channelName: string;
  getLevels: UseAudioLevelsReturn["getLevels"];
}) {
  const getChannelLevels = useCallback(
    () => getLevels(channelId),
    [getLevels, channelId],
  );

  return (
    <VuMeter
      channelName={channelName}
      getLevels={getChannelLevels}
    />
  );
}
