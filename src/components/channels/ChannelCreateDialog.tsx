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
    <form
      className="bg-card border border-border rounded-md p-5 max-w-md flex flex-col gap-4"
      onSubmit={handleSubmit}
    >
      <h3 className="text-base font-semibold text-foreground">New Channel</h3>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="channel-name" className="text-sm font-medium text-muted-foreground">
          Name
        </label>
        <input
          id="channel-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. English, Spanish"
          autoFocus
          className="px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="channel-format" className="text-sm font-medium text-muted-foreground">
          Output Format
        </label>
        <select
          id="channel-format"
          value={outputFormat}
          onChange={(e) =>
            setOutputFormat(e.target.value as ChannelOutputFormat)
          }
          className="px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring"
        >
          <option value="mono">Mono</option>
          <option value="stereo">Stereo</option>
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          className="px-3 py-1.5 bg-transparent border border-border rounded-md text-muted-foreground text-sm cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
          disabled={!name.trim()}
        >
          Create
        </button>
      </div>
    </form>
  );
}
