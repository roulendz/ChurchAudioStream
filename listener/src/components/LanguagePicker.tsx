/**
 * Language selection list showing available locales.
 *
 * Each row: native language name. Active language highlighted with accent.
 * On select: i18next changes language, all UI re-renders, saved to localStorage.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

interface LanguageOption {
  readonly code: string;
  readonly nativeName: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: "en", nativeName: "English" },
  { code: "es", nativeName: "Espanol" },
  { code: "lv", nativeName: "Latviesu" },
];

export function LanguagePicker() {
  const { i18n, t } = useTranslation();

  const handleSelect = useCallback(
    (code: string) => () => {
      i18n.changeLanguage(code);
    },
    [i18n],
  );

  return (
    <div className="language-picker" role="listbox" aria-label={t("settings.language")}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          className={`language-picker__option ${i18n.language === lang.code ? "language-picker__option--active" : ""}`}
          onClick={handleSelect(lang.code)}
          role="option"
          aria-selected={i18n.language === lang.code}
          type="button"
        >
          <span className="language-picker__name">{lang.nativeName}</span>
          {i18n.language === lang.code && (
            <svg className="language-picker__check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
