import { describe, expect, it } from "vitest";
import { advanceJoinWindow } from "./antiraid";
import { evaluateRaidSignals } from "../security";

describe("Anti-Raid join windows", () => {
  it("starts one raid window at the configured join threshold", () => {
    let state = { joins: [] as number[], raidUntil: 0 };
    state = advanceJoinWindow(state, 1_000, 10_000, 3).state;
    const second = advanceJoinWindow(state, 2_000, 10_000, 3);
    expect(second.started).toBe(false);
    const third = advanceJoinWindow(second.state, 3_000, 10_000, 3);
    expect(third.started).toBe(true);
    expect(third.active).toBe(true);
    expect(third.count).toBe(3);
  });

  it("does not let account age alone masquerade as a join burst", () => {
    const result = evaluateRaidSignals({
      accountAgeMs: 60_000,
      accountAgeThresholdMs: 86_400_000,
      joinsInWindow: 1,
      joinThreshold: 8,
    });
    expect(result.signals).toEqual(["new_account"]);
  });
});
