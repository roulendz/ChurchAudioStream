/**
 * Pill-shaped toggle for server-side audio enhancement (AGC).
 *
 * When ON: accent background. When OFF: hairline border only.
 * Disabled when not playing (greyed out).
 * Shows hint text: "Affects all listeners on this channel".
 */
import { useTranslation } from "react-i18next";

interface ProcessingToggleProps {
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly disabled: boolean;
}

export function ProcessingToggle({ enabled, onToggle, disabled }: ProcessingToggleProps) {
  const { t } = useTranslation();

  return (
    <div className={`processing-toggle ${disabled ? "processing-toggle--disabled" : ""}`}>
      <div className="processing-toggle__info">
        <span className="processing-toggle__label">{t("settings.audioEnhancement")}</span>
        <span className="processing-toggle__hint">{t("settings.audioEnhancementHint")}</span>
      </div>
      <button
        className={`processing-toggle__switch ${enabled ? "processing-toggle__switch--on" : ""}`}
        onClick={onToggle}
        disabled={disabled}
        role="switch"
        aria-checked={enabled}
        aria-label={t("settings.audioEnhancement")}
        type="button"
      >
        <span className="processing-toggle__thumb" />
      </button>
    </div>
  );
}
