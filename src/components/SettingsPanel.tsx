import { useState, useEffect, useCallback } from "react";
import type {
  AppConfig,
  NetworkInterface,
  ConfigUpdateResult,
} from "../hooks/useServerStatus";

interface SettingsPanelProps {
  config: AppConfig | null;
  interfaces: NetworkInterface[];
  onSave: (partial: Partial<AppConfig>) => Promise<ConfigUpdateResult>;
}

type SaveStatus = "idle" | "saving" | "restarting" | "saved" | "error";

interface FormState {
  port: string;
  selectedInterface: string;
  mdnsEnabled: boolean;
  mdnsDomain: string;
}

function buildFormStateFromConfig(config: AppConfig): FormState {
  return {
    port: String(config.server.port),
    selectedInterface: config.server.interface ?? "",
    mdnsEnabled: config.network.mdns.enabled,
    mdnsDomain: config.network.mdns.domain,
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

  // Find the host address for the selected interface
  if (formState.selectedInterface !== (originalConfig.server.interface ?? "")) {
    diff.server = {
      ...diff.server,
      interface: formState.selectedInterface || undefined,
    } as AppConfig["server"];
    hasChanges = true;
  }

  if (formState.mdnsEnabled !== originalConfig.network.mdns.enabled) {
    diff.network = {
      ...diff.network,
      mdns: {
        ...originalConfig.network.mdns,
        ...diff.network?.mdns,
        enabled: formState.mdnsEnabled,
      },
    } as AppConfig["network"];
    hasChanges = true;
  }

  if (formState.mdnsDomain !== originalConfig.network.mdns.domain) {
    diff.network = {
      ...diff.network,
      mdns: {
        ...originalConfig.network.mdns,
        ...diff.network?.mdns,
        domain: formState.mdnsDomain,
      },
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

export function SettingsPanel({
  config,
  interfaces,
  onSave,
}: SettingsPanelProps) {
  const [formState, setFormState] = useState<FormState>({
    port: "7777",
    selectedInterface: "",
    mdnsEnabled: true,
    mdnsDomain: "churchaudio.local",
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

  const handleMdnsEnabledChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({
        ...prev,
        mdnsEnabled: e.target.checked,
      }));
    },
    [],
  );

  const handleMdnsDomainChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({
        ...prev,
        mdnsDomain: e.target.value,
      }));
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
        // The status will update when reconnection happens
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
      <section className="settings-panel">
        <h2>Server Settings</h2>
        <p className="settings-loading">Loading configuration...</p>
      </section>
    );
  }

  return (
    <section className="settings-panel">
      <h2>Server Settings</h2>

      <div className="settings-form">
        <div className="form-field">
          <label htmlFor="settings-port">Port</label>
          <input
            id="settings-port"
            type="number"
            min={1024}
            max={65535}
            value={formState.port}
            onChange={handlePortChange}
            className={portError ? "input-error" : ""}
          />
          {portError && (
            <span className="field-error">{portError}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="settings-interface">Network Interface</label>
          <select
            id="settings-interface"
            value={formState.selectedInterface}
            onChange={handleInterfaceChange}
          >
            <option value="">Auto (first available)</option>
            {interfaces.map((iface) => (
              <option key={`${iface.name}-${iface.address}`} value={iface.name}>
                {iface.name} ({iface.address})
              </option>
            ))}
          </select>
        </div>

        <div className="form-field form-field--checkbox">
          <label htmlFor="settings-mdns">
            <input
              id="settings-mdns"
              type="checkbox"
              checked={formState.mdnsEnabled}
              onChange={handleMdnsEnabledChange}
            />
            Enable mDNS Discovery
          </label>
        </div>

        <div className="form-field">
          <label htmlFor="settings-mdns-domain">mDNS Domain</label>
          <input
            id="settings-mdns-domain"
            type="text"
            value={formState.mdnsDomain}
            onChange={handleMdnsDomainChange}
            disabled={!formState.mdnsEnabled}
            placeholder="churchaudio.local"
          />
        </div>

        {errorMessages.length > 0 && (
          <div className="settings-errors" role="alert">
            {errorMessages.map((err, idx) => (
              <p key={idx} className="settings-error-message">
                {err}
              </p>
            ))}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn-save"
            onClick={handleSave}
            disabled={
              !isDirty || portError !== null || saveStatus === "saving"
            }
          >
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "restarting"
                ? "Server Restarting..."
                : saveStatus === "saved"
                  ? "Saved"
                  : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}
