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

/** Group sources by type for easier selection. */
function groupSourcesByType(
  sources: DiscoveredSource[],
): Map<string, DiscoveredSource[]> {
  const groups = new Map<string, DiscoveredSource[]>();
  for (const source of sources) {
    const key = source.type === "aes67" ? "AES67 / Dante" : "Local Devices";
    const existing = groups.get(key) ?? [];
    existing.push(source);
    groups.set(key, existing);
  }
  return groups;
}

/** Find source by ID in the flat source list. */
function findSourceById(
  sources: DiscoveredSource[],
  sourceId: string,
): DiscoveredSource | undefined {
  return sources.find((s) => s.id === sourceId);
}

export function SourceSelector({
  sources,
  assignedSources,
  onAddSource,
  onRemoveSource,
}: SourceSelectorProps) {
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);

  const grouped = groupSourcesByType(sources);
  const selectedSource = selectedSourceId
    ? findSourceById(sources, selectedSourceId)
    : undefined;
  const channelOptions = selectedSource
    ? buildChannelOptions(selectedSource)
    : [];

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
    onAddSource(selectedSourceId, selectedChannels);
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
                  </span>
                  <span className="assigned-source-channels">
                    Ch: {assignment.selectedChannels.join(", ")}
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
                    {src.name}
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
