/**
 * i18next initialization with browser language detection.
 *
 * Detection order: localStorage ("cas_language") -> navigator.language.
 * Bundled locales (no network fetch) for offline PWA support.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";
import lv from "./locales/lv.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      lv: { translation: lv },
    },
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "cas_language",
    },
  });

export default i18n;
