/**
 * Settings bottom sheet containing Language, Theme, and Audio Enhancement.
 *
 * Uses same slide-up animation as StatsPanel (stats-slide-up keyframes).
 * Audio Enhancement toggle only visible when isPlaying is true.
 */
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "../hooks/useTheme";
import { ThemeToggle } from "./ThemeToggle";
import { LanguagePicker } from "./LanguagePicker";
import { ProcessingToggle } from "./ProcessingToggle";

interface SettingsPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly themeMode: ThemeMode;
  readonly onThemeModeChange: (mode: ThemeMode) => void;
  readonly processingEnabled: boolean;
  readonly onProcessingToggle: () => void;
  readonly isPlaying: boolean;
}

export function SettingsPanel({
  open,
  onClose,
  themeMode,
  onThemeModeChange,
  processingEnabled,
  onProcessingToggle,
  isPlaying,
}: SettingsPanelProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onClick={onClose}
    >
      <div
        className="settings-panel__sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">{t("settings.title")}</h2>
          <button
            className="settings-panel__close-btn"
            onClick={onClose}
            aria-label={t("share.close")}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-panel__section">
          <span className="settings-panel__section-label">{t("settings.language")}</span>
          <LanguagePicker />
        </div>

        <div className="settings-panel__section">
          <span className="settings-panel__section-label">{t("settings.appearance")}</span>
          <ThemeToggle mode={themeMode} onModeChange={onThemeModeChange} />
        </div>

        {isPlaying && (
          <div className="settings-panel__section">
            <ProcessingToggle
              enabled={processingEnabled}
              onToggle={onProcessingToggle}
              disabled={!isPlaying}
            />
          </div>
        )}
      </div>
    </div>
  );
}
