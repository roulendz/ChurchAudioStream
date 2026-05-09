import { describe, it, expect } from "vitest";
import { BUILD_VERSION } from "./version";

describe("BUILD_VERSION", () => {
  it("is a string", () => {
    expect(typeof BUILD_VERSION).toBe("string");
  });

  it("falls back to 'dev' when __BUILD_VERSION__ is not defined at build time", () => {
    expect(BUILD_VERSION).toBe("dev");
  });
});
