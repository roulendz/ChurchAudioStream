/**
 * 3-segment theme toggle: Light | System | Dark.
 *
 * Active segment gets accent background + accent-strong text.
 * Inactive segments use surface-glass background with text-muted icons.
 * 40px tall pill container with rounded-full corners.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "../hooks/useTheme";

interface ThemeToggleProps {
  readonly mode: ThemeMode;
  readonly onModeChange: (mode: ThemeMode) => void;
}

const SEGMENTS: { value: ThemeMode; labelKey: string; icon: string }[] = [
  { value: "light", labelKey: "settings.themeLight", icon: "sun" },
  { value: "system", labelKey: "settings.themeSystem", icon: "system" },
  { value: "dark", labelKey: "settings.themeDark", icon: "moon" },
];

function ThemeIcon({ type }: { readonly type: string }) {
  switch (type) {
    case "sun":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 2v1M8 13v1M2 8h1M13 8h1M4.2 4.2l.7.7M11.1 11.1l.7.7M4.2 11.8l.7-.7M11.1 4.9l.7-.7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "moon":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 9.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function ThemeToggle({ mode, onModeChange }: ThemeToggleProps) {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (value: ThemeMode) => () => onModeChange(value),
    [onModeChange],
  );

  return (
    <div className="theme-toggle" role="radiogroup" aria-label={t("settings.appearance")}>
      {SEGMENTS.map((seg) => (
        <button
          key={seg.value}
          className={`theme-toggle__segment ${mode === seg.value ? "theme-toggle__segment--active" : ""}`}
          onClick={handleSelect(seg.value)}
          role="radio"
          aria-checked={mode === seg.value}
          aria-label={t(seg.labelKey)}
          type="button"
        >
          <ThemeIcon type={seg.icon} />
          <span className="theme-toggle__label">{t(seg.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
