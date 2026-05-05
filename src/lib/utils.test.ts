import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges multiple class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("deduplicates conflicting Tailwind utilities (later wins)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("filters out falsy values", () => {
    expect(cn("text-red-500", false, "bg-blue-500")).toBe("text-red-500 bg-blue-500");
  });

  it("filters undefined, null, and empty strings", () => {
    expect(cn("base", undefined, null, "", "extra")).toBe("base extra");
  });

  it("returns empty string with no args", () => {
    expect(cn()).toBe("");
  });

  it("supports object syntax (clsx feature)", () => {
    expect(cn("foo", { bar: true, baz: false })).toBe("foo bar");
  });

  it("merges overlapping Tailwind axis utilities", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
