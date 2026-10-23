import { describe, expect, it } from "vitest";
import { chooseGiveawayWinners } from "./giveaways";

describe("chooseGiveawayWinners", () => {
  it("chooses unique entries deterministically with injected RNG", () => {
    const values = ["a", "b", "c", "d"];
    const draws = [1, 0, 1];
    expect(chooseGiveawayWinners(values, 3, () => draws.shift()!)).toEqual(["b", "a", "d"]);
  });
  it("caps winner count to available entries and handles empty pools", () => {
    expect(chooseGiveawayWinners([7], 10, () => 0)).toEqual([7]);
    expect(chooseGiveawayWinners([], 2)).toEqual([]);
    expect(chooseGiveawayWinners([1, 2], 0)).toEqual([]);
  });
  it("rejects a broken RNG", () => {
    expect(() => chooseGiveawayWinners(["x"], 1, () => 1)).toThrow("rng_out_of_range");
  });
});
