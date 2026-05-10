import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type {
  AppConfig,
  NetworkInterface,
  ConfigUpdateResult,
} from "../hooks/useServerStatus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  config: AppConfig | null;
  interfaces: NetworkInterface[];
  onSave: (partial: Partial<AppConfig>) => Promise<ConfigUpdateResult>;
}

type SaveStatus = "idle" | "saving" | "restarting" | "saved" | "error";

interface FormState {
  port: string;
  selectedInterface: string;
  domain: string;
  mdnsEnabled: boolean;
  hostsFileEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFormStateFromConfig(config: AppConfig): FormState {
  return {
    port: String(config.server.port),
    selectedInterface: config.server.interface ?? "",
    domain: config.network.domain,
    mdnsEnabled: config.network.mdns.enabled,
    hostsFileEnabled: config.network.hostsFile.enabled,
  };
}

function buildConfigDiff(
  formState: FormState,
  originalConfig: AppConfig,
): Partial<AppConfig> | null {
  const diff: Partial<AppConfig> = {};
  let hasChanges = false;

  const newPort = parseInt(formState.port, 10);
  if (!isNaN(newPort) && newPort !== originalConfig.server.port) {
    diff.server = { ...diff.server, port: newPort } as AppConfig["server"];
    hasChanges = true;
  }

  if (formState.selectedInterface !== (originalConfig.server.interface ?? "")) {
    diff.server = {
      ...diff.server,
      interface: formState.selectedInterface || undefined,
    } as AppConfig["server"];
    hasChanges = true;
  }

  if (formState.domain !== originalConfig.network.domain) {
    diff.network = {
      ...diff.network,
      domain: formState.domain,
    } as AppConfig["network"];
    hasChanges = true;
  }

  if (formState.mdnsEnabled !== originalConfig.network.mdns.enabled) {
    diff.network = {
      ...diff.network,
      mdns: { enabled: formState.mdnsEnabled },
    } as AppConfig["network"];
    hasChanges = true;
  }

  if (formState.hostsFileEnabled !== originalConfig.network.hostsFile.enabled) {
    diff.network = {
      ...diff.network,
      hostsFile: { enabled: formState.hostsFileEnabled },
    } as AppConfig["network"];
    hasChanges = true;
  }

  return hasChanges ? diff : null;
}

function validatePort(value: string): string | null {
  const num = parseInt(value, 10);
  if (isNaN(num)) return "Port must be a number";
  if (num < 1024) return "Port must be 1024 or higher";
  if (num > 65535) return "Port must be 65535 or lower";
  return null;
}

// ---------------------------------------------------------------------------
// Save button label
// ---------------------------------------------------------------------------

function saveButtonLabel(status: SaveStatus): string {
  switch (status) {
    case "saving": return "Saving...";
    case "restarting": return "Server Restarting...";
    case "saved": return "Saved";
    default: return "Save";
  }
}

// ---------------------------------------------------------------------------
// Input class builder
// ---------------------------------------------------------------------------

const inputBaseClasses =
  "px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm outline-none transition-colors focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed";

// ---------------------------------------------------------------------------
// DesignTokensSection
// ---------------------------------------------------------------------------

interface TokenSwatch {
  name: string;
  className: string;
}

interface TokenGroup {
  label: string;
  tokens: TokenSwatch[];
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: "Backgrounds",
    tokens: [
      { name: "background", className: "bg-background" },
      { name: "card", className: "bg-card" },
      { name: "secondary", className: "bg-secondary" },
      { name: "muted", className: "bg-muted" },
      { name: "input", className: "bg-input" },
    ],
  },
  {
    label: "Semantic",
    tokens: [
      { name: "primary", className: "bg-primary" },
      { name: "destructive", className: "bg-destructive" },
      { name: "success", className: "bg-success" },
      { name: "warning", className: "bg-warning" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { name: "foreground", className: "bg-card text-foreground" },
      { name: "muted-foreground", className: "bg-card text-muted-foreground" },
    ],
  },
  {
    label: "Borders",
    tokens: [
      { name: "border", className: "border-2 border-border bg-transparent" },
    ],
  },
];

function DesignTokensSection() {
  return (
    <section className="bg-card border border-border rounded-md p-5">
      <h2 className="text-lg font-semibold mb-4 text-foreground">Design Tokens</h2>
      {TOKEN_GROUPS.map(({ label, tokens }) => (
        <div key={label} className="mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">{label}</h3>
          <div className="flex flex-wrap gap-3">
            {tokens.map(({ name, className }) => (
              <div key={name} className="flex flex-col items-center gap-1">
                {label === "Text" ? (
                  <div
                    className={cn(
                      "size-10 rounded-md border border-border flex items-center justify-center text-xs font-bold",
                      className
                    )}
                  >
                    Aa
                  </div>
                ) : (
                  <div className={cn("size-10 rounded-md border border-border", className)} />
                )}
                <span className="text-xs text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="mb-0">
        <h3 className="text-sm font-semibold text-foreground mb-2">Typography</h3>
        <div className="flex flex-col gap-2 text-sm text-foreground">
          <div>
            <span className="text-muted-foreground">Sans: </span>
            <span className="font-sans">system-ui, sans-serif</span>
          </div>
          <div>
            <span className="text-muted-foreground">Mono: </span>
            <span className="font-[family-name:var(--font-mono)]">var(--font-mono)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export function SettingsPanel({
  config,
  interfaces,
  onSave,
}: SettingsPanelProps) {
  const [formState, setFormState] = useState<FormState>({
    port: "7777",
    selectedInterface: "",
    domain: "church.audio",
    mdnsEnabled: true,
    hostsFileEnabled: true,
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [portError, setPortError] = useState<string | null>(null);

  // Sync form state when config loads or changes from server
  useEffect(() => {
    if (config) {
      setFormState(buildFormStateFromConfig(config));
      setErrorMessages([]);
      setPortError(null);
    }
  }, [config]);

  const isDirty =
    config !== null &&
    buildConfigDiff(formState, config) !== null;

  const handlePortChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setFormState((prev) => ({ ...prev, port: value }));
      setPortError(validatePort(value));
    },
    [],
  );

  const handleInterfaceChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setFormState((prev) => ({
        ...prev,
        selectedInterface: e.target.value,
      }));
    },
    [],
  );

  const handleDomainChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, domain: e.target.value }));
    },
    [],
  );

  const handleMdnsEnabledChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, mdnsEnabled: e.target.checked }));
    },
    [],
  );

  const handleHostsFileEnabledChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, hostsFileEnabled: e.target.checked }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!config || portError) return;

    const diff = buildConfigDiff(formState, config);
    if (!diff) return;

    setSaveStatus("saving");
    setErrorMessages([]);

    const result = await onSave(diff);

    if (result.success) {
      if (result.requiresRestart) {
        setSaveStatus("restarting");
        setTimeout(() => {
          setSaveStatus("idle");
        }, 5000);
      } else {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
    } else {
      setSaveStatus("error");
      setErrorMessages(result.errors ?? ["Unknown error"]);
    }
  }, [config, formState, onSave, portError]);

  if (!config) {
    return (
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-foreground mb-5">Server Settings</h2>
        <p className="text-muted-foreground italic">Loading configuration...</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground mb-5">Server Settings</h2>

      <div className="bg-card border border-border rounded-md p-5 flex flex-col gap-4">
        {/* Port */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-port" className="text-sm font-medium text-muted-foreground">
            Port
          </label>
          <input
            id="settings-port"
            type="number"
            min={1024}
            max={65535}
            value={formState.port}
            onChange={handlePortChange}
            className={cn(inputBaseClasses, portError && "border-destructive")}
          />
          {portError && (
            <span className="text-xs text-destructive">{portError}</span>
          )}
        </div>

        {/* Network Interface */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-interface" className="text-sm font-medium text-muted-foreground">
            Network Interface
          </label>
          <select
            id="settings-interface"
            value={formState.selectedInterface}
            onChange={handleInterfaceChange}
            className={inputBaseClasses}
          >
            <option value="">Auto (first available)</option>
            {interfaces.map((iface) => (
              <option key={`${iface.name}-${iface.address}`} value={iface.name}>
                {iface.name} ({iface.address})
              </option>
            ))}
          </select>
        </div>

        {/* Domain */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-domain" className="text-sm font-medium text-muted-foreground">
            Domain
          </label>
          <input
            id="settings-domain"
            type="text"
            value={formState.domain}
            onChange={handleDomainChange}
            placeholder="church.audio"
            className={inputBaseClasses}
          />
          <span className="text-xs text-muted-foreground">
            Used for mDNS discovery, hosts file, and TLS certificate
          </span>
        </div>

        {/* mDNS checkbox */}
        <div className="flex items-center gap-2">
          <label htmlFor="settings-mdns" className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              id="settings-mdns"
              type="checkbox"
              checked={formState.mdnsEnabled}
              onChange={handleMdnsEnabledChange}
              className="size-4 accent-primary cursor-pointer"
            />
            Enable mDNS Discovery
          </label>
        </div>

        {/* Hosts file checkbox */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="settings-hosts-file" className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                id="settings-hosts-file"
                type="checkbox"
                checked={formState.hostsFileEnabled}
                onChange={handleHostsFileEnabledChange}
                className="size-4 accent-primary cursor-pointer"
              />
              Update Hosts File
            </label>
          </div>
          <span className="text-xs text-muted-foreground">
            Maps domain to server IP in system hosts file (requires admin)
          </span>
        </div>

        {/* Errors */}
        {errorMessages.length > 0 && (
          <div className="bg-destructive/10 border border-destructive rounded-md p-3" role="alert">
            {errorMessages.map((err, idx) => (
              <p key={idx} className="text-sm text-destructive">
                {err}
              </p>
            ))}
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            className={cn(
              "px-6 py-2 rounded-md text-sm font-medium min-w-[140px] cursor-pointer transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            )}
            onClick={handleSave}
            disabled={
              !isDirty || portError !== null || saveStatus === "saving"
            }
          >
            {saveButtonLabel(saveStatus)}
          </button>
        </div>
      </div>

      <DesignTokensSection />
    </section>
  );
}
