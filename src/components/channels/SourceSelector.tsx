import { useState } from "react";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold text-foreground">Input Sources</h4>

      {/* Assigned sources list */}
      {assignedSources.length > 0 && (
        <ul className="list-none flex flex-col gap-1.5">
          {assignedSources.map((assignment, index) => {
            const source = findSourceById(sources, assignment.sourceId);
            return (
              <li
                key={index}
                className="flex items-center justify-between px-2.5 py-1.5 bg-secondary/50 rounded-md"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground font-medium">
                    {source?.name ?? assignment.sourceId}
                    {source ? ` ${formatSourceSpecLabel(source)}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Ch: {assignment.selectedChannels.map((c) => c + 1).join(", ")} → 48kHz
                  </span>
                </div>
                <button
                  type="button"
                  className="bg-transparent border border-transparent rounded-md text-destructive size-6 text-[0.65rem] inline-flex items-center justify-center cursor-pointer transition-all hover:border-destructive/50 hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
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
        <p className="text-sm text-muted-foreground italic">No sources assigned</p>
      )}

      {/* Add source controls */}
      <div className="flex flex-col gap-2 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={hideUnavailable}
            onChange={(e) => handleToggleHideUnavailable(e.target.checked)}
            className="accent-primary"
          />
          Hide unavailable sources
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="source-select" className="text-sm font-medium text-muted-foreground">
            Add Source
          </label>
          <select
            id="source-select"
            value={selectedSourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring"
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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Channels:</span>
            <div className="flex gap-1 flex-wrap">
              {channelOptions.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={cn(
                    "size-7 border rounded-md text-xs inline-flex items-center justify-center cursor-pointer transition-all",
                    selectedChannels.includes(ch)
                      ? "bg-primary border-primary text-primary-foreground hover:bg-accent-hover"
                      : "bg-transparent border-border text-muted-foreground hover:border-primary hover:text-primary",
                  )}
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
          className="self-start px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
          disabled={!selectedSourceId || selectedChannels.length === 0}
          onClick={handleAddSource}
        >
          Add Source
        </button>
      </div>
    </div>
  );
}
