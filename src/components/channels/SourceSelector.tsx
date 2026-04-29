import { useState } from "react";
import type { DiscoveredSource } from "../../hooks/useSources";
import type { SourceAssignment } from "../../hooks/useChannels";

interface SourceSelectorProps {
  sources: DiscoveredSource[];
  assignedSources: SourceAssignment[];
  onAddSource: (sourceId: string, selectedChannels: number[]) => void;
  onRemoveSource: (sourceIndex: number) => void;
}

/**
 * Build an array of selectable channel numbers for a source.
 * AES67 sources expose channelCount; local devices also report channelCount.
 */
function buildChannelOptions(source: DiscoveredSource): number[] {
  const count = source.channelCount || 2;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Derive a user-friendly group label for a source.
 *
 * Groups by source type first (AES67 vs local), then by device direction
 * (microphones vs loopback/output) for local devices.
 */
function deriveGroupLabel(source: DiscoveredSource): string {
  if (source.type === "aes67") return "AES67 / Dante";
  if (source.type === "file") return "Test Sources (File Loop)";

  if (source.isLoopback) return "Loopback (System Audio)";

  const direction = source.direction ?? "source";
  if (direction === "sink") return "Output Devices";

  return "Input Devices (Microphones)";
}

/** Human-readable channel count label: "Mono", "Stereo", or "Nch". */
function formatChannelCountLabel(channelCount: number | undefined): string {
  if (!channelCount || channelCount < 1) return "?ch";
  if (channelCount === 1) return "Mono";
  if (channelCount === 2) return "Stereo";
  return `${channelCount}ch`;
}

/** Human-readable sample rate label: "48kHz", "192kHz", or "?Hz" if unknown. */
function formatSampleRateLabel(sampleRate: number | undefined): string {
  if (!sampleRate || sampleRate < 1) return "?Hz";
  if (sampleRate >= 1000) return `${Math.round(sampleRate / 1000)}kHz`;
  return `${sampleRate}Hz`;
}

/** Combined source-format suffix shown after the source name: "[Stereo, 48kHz]". */
function formatSourceSpecLabel(source: DiscoveredSource): string {
  const channels = formatChannelCountLabel(source.channelCount);
  const rate = formatSampleRateLabel(source.sampleRate);
  return `[${channels}, ${rate}]`;
}

/** Ordered group labels for consistent dropdown rendering. */
const GROUP_ORDER = [
  "AES67 / Dante",
  "Test Sources (File Loop)",
  "Input Devices (Microphones)",
  "Loopback (System Audio)",
  "Output Devices",
];

/** Group sources by type and direction for easier selection. */
function groupSourcesByType(
  sources: DiscoveredSource[],
): Map<string, DiscoveredSource[]> {
  const groups = new Map<string, DiscoveredSource[]>();
  for (const source of sources) {
    const key = deriveGroupLabel(source);
    const existing = groups.get(key) ?? [];
    existing.push(source);
    groups.set(key, existing);
  }

  // Return groups in a consistent order
  const ordered = new Map<string, DiscoveredSource[]>();
  for (const label of GROUP_ORDER) {
    const items = groups.get(label);
    if (items && items.length > 0) {
      ordered.set(label, items);
    }
  }
  return ordered;
}

/** Find source by ID in the flat source list. */
function findSourceById(
  sources: DiscoveredSource[],
  sourceId: string,
): DiscoveredSource | undefined {
  return sources.find((s) => s.id === sourceId);
}

/** Filter out sources whose status is not "available" when the toggle is on. */
function filterSourcesByAvailability(
  sources: DiscoveredSource[],
  hideUnavailable: boolean,
): DiscoveredSource[] {
  if (!hideUnavailable) return sources;
  return sources.filter((source) => source.status === "available");
}

export function SourceSelector({
  sources,
  assignedSources,
  onAddSource,
  onRemoveSource,
}: SourceSelectorProps) {
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [hideUnavailable, setHideUnavailable] = useState(true);

  const visibleSources = filterSourcesByAvailability(sources, hideUnavailable);
  const grouped = groupSourcesByType(visibleSources);
  const selectedSource = selectedSourceId
    ? findSourceById(sources, selectedSourceId)
    : undefined;
  const channelOptions = selectedSource
    ? buildChannelOptions(selectedSource)
    : [];

  function handleToggleHideUnavailable(checked: boolean) {
    setHideUnavailable(checked);
    if (!checked) return;
    if (!selectedSourceId) return;
    const stillVisible = sources.some(
      (source) => source.id === selectedSourceId && source.status === "available",
    );
    if (stillVisible) return;
    setSelectedSourceId("");
    setSelectedChannels([]);
  }

  function handleSourceChange(sourceId: string) {
    setSelectedSourceId(sourceId);
    // Default to first channel when switching source
    const src = findSourceById(sources, sourceId);
    if (src) {
      setSelectedChannels([1]);
    } else {
      setSelectedChannels([]);
    }
  }

  function handleChannelToggle(channel: number) {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel].sort((a, b) => a - b),
    );
  }

  function handleAddSource() {
    if (!selectedSourceId || selectedChannels.length === 0) return;
    const zeroIndexedChannels = selectedChannels.map((ch) => ch - 1);
    onAddSource(selectedSourceId, zeroIndexedChannels);
    setSelectedSourceId("");
    setSelectedChannels([]);
  }

  return (
    <div className="source-selector">
      <h4 className="source-selector-title">Input Sources</h4>

      {/* Assigned sources list */}
      {assignedSources.length > 0 && (
        <ul className="assigned-sources-list">
          {assignedSources.map((assignment, index) => {
            const source = findSourceById(sources, assignment.sourceId);
            return (
              <li key={index} className="assigned-source-item">
                <div className="assigned-source-info">
                  <span className="assigned-source-name">
                    {source?.name ?? assignment.sourceId}
                    {source ? ` ${formatSourceSpecLabel(source)}` : ""}
                  </span>
                  <span className="assigned-source-channels">
                    Ch: {assignment.selectedChannels.map((c) => c + 1).join(", ")} → 48kHz
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-icon btn-remove-source"
                  onClick={() => onRemoveSource(index)}
                  title="Remove source"
                >
                  X
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {assignedSources.length === 0 && (
        <p className="source-selector-empty">No sources assigned</p>
      )}

      {/* Add source controls */}
      <div className="source-add-controls">
        <div className="form-field form-field--checkbox">
          <label>
            <input
              type="checkbox"
              checked={hideUnavailable}
              onChange={(e) => handleToggleHideUnavailable(e.target.checked)}
            />
            Hide unavailable sources
          </label>
        </div>

        <div className="form-field">
          <label htmlFor="source-select">Add Source</label>
          <select
            id="source-select"
            value={selectedSourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
          >
            <option value="">-- Select source --</option>
            {Array.from(grouped.entries()).map(([groupName, groupSources]) => (
              <optgroup key={groupName} label={groupName}>
                {groupSources.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.name} {formatSourceSpecLabel(src)}
                    {src.status !== "available" ? ` (${src.status})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {selectedSource && channelOptions.length > 0 && (
          <div className="channel-picker">
            <span className="channel-picker-label">Channels:</span>
            <div className="channel-picker-buttons">
              {channelOptions.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`channel-pick-btn ${selectedChannels.includes(ch) ? "channel-pick-btn--active" : ""}`}
                  onClick={() => handleChannelToggle(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn-primary btn-add-source"
          disabled={!selectedSourceId || selectedChannels.length === 0}
          onClick={handleAddSource}
        >
          Add Source
        </button>
      </div>
    </div>
  );
}
