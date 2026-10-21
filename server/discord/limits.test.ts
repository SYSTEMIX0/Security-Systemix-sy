import { describe, expect, it } from "vitest";
import { pushSlidingSample, RollingWriteBudget } from "./limits";

describe("Discord runtime limits", () => {
  it("bounds total writes and releases capacity when the window expires", () => {
    const budget = new RollingWriteBudget(2, 60_000, 1);

    expect(budget.tryConsume(false, 1_000)).toBe(true);
    expect(budget.tryConsume(false, 2_000)).toBe(true);
    expect(budget.tryConsume(false, 3_000)).toBe(false);
    expect(budget.tryConsume(false, 62_001)).toBe(true);
  });

  it("reserves a separate cap for high-priority events without exceeding the total cap", () => {
    const budget = new RollingWriteBudget(3, 60_000, 1);

    expect(budget.tryConsume(true, 1_000)).toBe(true);
    expect(budget.tryConsume(true, 2_000)).toBe(false);
    expect(budget.tryConsume(false, 3_000)).toBe(true);
    expect(budget.tryConsume(false, 4_000)).toBe(true);
    expect(budget.tryConsume(true, 5_000)).toBe(false);
  });

  it("keeps only in-window timestamps and caps the number of samples", () => {
    expect(pushSlidingSample([0, 9, 18], 20, 10, 2)).toEqual([18, 20]);
    expect(pushSlidingSample([1, 2], 20, 5, 2)).toEqual([20]);
  });
});
