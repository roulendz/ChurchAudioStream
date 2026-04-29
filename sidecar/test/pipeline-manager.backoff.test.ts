/**
 * Tests for PipelineManager.computeBackoffDelay -- the fast-first-attempt
 * recovery path. Attempt 1 must use firstAttemptDelayMs; attempts 2..N must
 * use restartDelayMs * 2^(attempt-2), capped at maxRestartDelayMs.
 *
 * Validates that a transient external kill (Task Manager / taskkill /F)
 * recovers quickly while a flapping device still gets rate-limited.
 */

import { describe, it, expect } from "vitest";
import {
  PipelineManager,
  type RecoveryConfig,
} from "../src/audio/pipeline/pipeline-manager";

const baseConfig: RecoveryConfig = {
  autoRestart: true,
  maxRestartAttempts: 5,
  firstAttemptDelayMs: 500,
  restartDelayMs: 2000,
  maxRestartDelayMs: 30000,
  drainTimeoutMs: 500,
};

interface BackoffProbe {
  computeBackoffDelay(attempt: number): number;
}

function makeManagerProbe(
  overrides: Partial<RecoveryConfig> = {},
): BackoffProbe {
  const manager = new PipelineManager({ ...baseConfig, ...overrides });
  return manager as unknown as BackoffProbe;
}

describe("PipelineManager.computeBackoffDelay - fast first attempt", () => {
  it("attempt 1 returns firstAttemptDelayMs (fast recovery from transient kill)", () => {
    const probe = makeManagerProbe();
    expect(probe.computeBackoffDelay(1)).toBe(500);
  });

  it("attempt 1 uses configured firstAttemptDelayMs override", () => {
    const probe = makeManagerProbe({ firstAttemptDelayMs: 250 });
    expect(probe.computeBackoffDelay(1)).toBe(250);
  });

  it("attempt 2 uses restartDelayMs base (no exponent yet)", () => {
    const probe = makeManagerProbe();
    // attempt 2 -> restartDelayMs * 2^0 = 2000
    expect(probe.computeBackoffDelay(2)).toBe(2000);
  });

  it("attempt 3 doubles restartDelayMs (exponential)", () => {
    const probe = makeManagerProbe();
    // attempt 3 -> 2000 * 2^1 = 4000
    expect(probe.computeBackoffDelay(3)).toBe(4000);
  });

  it("attempt 4 quadruples restartDelayMs", () => {
    const probe = makeManagerProbe();
    // attempt 4 -> 2000 * 2^2 = 8000
    expect(probe.computeBackoffDelay(4)).toBe(8000);
  });

  it("attempt 5 is capped at maxRestartDelayMs", () => {
    const probe = makeManagerProbe({ maxRestartDelayMs: 5000 });
    // unbounded would be 2000 * 2^3 = 16000; cap clamps to 5000
    expect(probe.computeBackoffDelay(5)).toBe(5000);
  });

  it("attempt 0 also returns firstAttemptDelayMs (defensive lower bound)", () => {
    const probe = makeManagerProbe();
    // attempts is incremented before this is called, but the guard `<= 1`
    // protects against any caller passing 0 or negative.
    expect(probe.computeBackoffDelay(0)).toBe(500);
  });
});
