import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system mode when no localStorage value", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
  });

  it("reads stored preference from localStorage", () => {
    localStorage.setItem("cas_theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("light");
  });

  it("falls back to system for invalid localStorage value", () => {
    localStorage.setItem("cas_theme", "garbage");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
  });

  it("sets data-theme attribute on html element for light mode", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("sets data-theme attribute on html element for dark mode", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("removes data-theme attribute for system mode", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    act(() => result.current.setMode("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("persists mode to localStorage on change", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    expect(localStorage.getItem("cas_theme")).toBe("dark");
  });

  it("resolvedTheme returns the explicit mode when not system", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    expect(result.current.resolvedTheme).toBe("light");
  });
});
