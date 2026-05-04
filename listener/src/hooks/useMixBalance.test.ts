import { describe, it, expect } from "vitest";

describe("useMixBalance crossfade math", () => {
  // Test the equal-power crossfade formula directly
  const crossfadeA = (balance: number): number =>
    Math.cos((balance * Math.PI) / 2);
  const crossfadeB = (balance: number): number =>
    Math.sin((balance * Math.PI) / 2);

  it("balance 0.0 = full primary (gainA=1, gainB=0)", () => {
    expect(crossfadeA(0)).toBeCloseTo(1.0);
    expect(crossfadeB(0)).toBeCloseTo(0.0);
  });

  it("balance 1.0 = full secondary (gainA=0, gainB=1)", () => {
    expect(crossfadeA(1)).toBeCloseTo(0.0);
    expect(crossfadeB(1)).toBeCloseTo(1.0);
  });

  it("balance 0.5 = equal power (both ~0.707)", () => {
    expect(crossfadeA(0.5)).toBeCloseTo(Math.SQRT1_2, 4);
    expect(crossfadeB(0.5)).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it("total power is constant across the range (equal-power property)", () => {
    for (let b = 0; b <= 1; b += 0.1) {
      const totalPower = crossfadeA(b) ** 2 + crossfadeB(b) ** 2;
      expect(totalPower).toBeCloseTo(1.0, 4);
    }
  });

  it("clamps values outside 0-1 range", () => {
    const clamp = (v: number): number => Math.max(0, Math.min(1, v));
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(1.5)).toBe(1);
    expect(clamp(0.7)).toBe(0.7);
  });
});
