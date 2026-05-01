import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

function makeContainer(buttonCount: number): HTMLDivElement {
  const div = document.createElement("div");
  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement("button");
    btn.textContent = `b${i}`;
    div.appendChild(btn);
  }
  document.body.appendChild(div);
  return div;
}

describe("useFocusTrap", () => {
  it("is a no-op when active=false", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    const focusSpy = vi.spyOn(container.querySelectorAll("button")[0]!, "focus");
    renderHook(() => useFocusTrap(false, ref));
    expect(focusSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it("is a no-op when containerRef.current is null", () => {
    const ref = createRef<HTMLElement>();
    expect(() => renderHook(() => useFocusTrap(true, ref))).not.toThrow();
  });

  it("focuses first focusable on activation", () => {
    const container = makeContainer(3);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    expect(document.activeElement).toBe(container.querySelectorAll("button")[0]);
    container.remove();
  });

  it("cycles Tab from last to first", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[1]!.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    container.remove();
  });

  it("cycles Shift-Tab from first to last", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[0]!.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    container.remove();
  });

  it("preventDefaults Tab when no focusables", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    container.remove();
  });

  it("ignores non-Tab key", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    container.remove();
  });

  it("does NOT preventDefault Tab when not at boundary (allows native traversal)", () => {
    const container = makeContainer(3);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[1]!.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    container.remove();
  });

  it("returns focus to previouslyFocused on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const container = makeContainer(1);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    const { unmount } = renderHook(() => useFocusTrap(true, ref));
    unmount();
    expect(document.activeElement).toBe(opener);
    container.remove();
    opener.remove();
  });
});
