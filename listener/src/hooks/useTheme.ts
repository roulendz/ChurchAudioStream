/**
 * Theme preference hook with system detection and manual override.
 *
 * Modes:
 * - "system": removes data-theme attr, CSS @media rule handles theme
 * - "light"/"dark": sets data-theme attr, overrides system preference
 *
 * Persists to localStorage key "cas_theme".
 * Listens to matchMedia("prefers-color-scheme") change events for
 * live system theme switch detection.
 */
import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface UseThemeResult {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Resolved actual theme (for components that need to know) */
  resolvedTheme: "light" | "dark";
}

const STORAGE_KEY = "cas_theme";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function useTheme(): UseThemeResult {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (mode === "system") return getSystemTheme();
    return mode;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") {
      root.removeAttribute("data-theme");
      setResolvedTheme(getSystemTheme());
    } else {
      root.setAttribute("data-theme", mode);
      setResolvedTheme(mode);
    }
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent): void => {
      if (mode === "system") {
        setResolvedTheme(e.matches ? "light" : "dark");
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  return { mode, setMode, resolvedTheme };
}
