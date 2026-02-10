import { useState } from "react";
import type { ChannelOutputFormat } from "../../hooks/useChannels";

interface ChannelCreateDialogProps {
  onCreate: (name: string, outputFormat?: ChannelOutputFormat) => void;
  onCancel: () => void;
}

export function ChannelCreateDialog({
  onCreate,
  onCancel,
}: ChannelCreateDialogProps) {
  const [name, setName] = useState("");
  const [outputFormat, setOutputFormat] = useState<ChannelOutputFormat>("mono");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onCreate(trimmedName, outputFormat);
  }

  return (
    <form className="channel-create-dialog" onSubmit={handleSubmit}>
      <h3 className="channel-create-title">New Channel</h3>
      <div className="form-field">
        <label htmlFor="channel-name">Name</label>
        <input
          id="channel-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. English, Spanish"
          autoFocus
        />
      </div>
      <div className="form-field">
        <label htmlFor="channel-format">Output Format</label>
        <select
          id="channel-format"
          value={outputFormat}
          onChange={(e) =>
            setOutputFormat(e.target.value as ChannelOutputFormat)
          }
        >
          <option value="mono">Mono</option>
          <option value="stereo">Stereo</option>
        </select>
      </div>
      <div className="channel-create-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={!name.trim()}
        >
          Create
        </button>
      </div>
    </form>
  );
}
