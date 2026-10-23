import { describe, expect, it } from "vitest";
import { LevelCooldown, levelForXp, xpForNextLevel } from "./leveling";

describe("leveling progression", () => {
  it("uses documented cumulative square curve boundaries", () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(99)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(399)).toBe(1);
    expect(levelForXp(400)).toBe(2);
    expect(xpForNextLevel(0)).toBe(100);
    expect(xpForNextLevel(2)).toBe(900);
  });
  it("reports current-level progress toward next threshold", () => {
    const xp = 250;
    const level = levelForXp(xp);
    expect({ earned: xp - 100 * level ** 2, needed: xpForNextLevel(level) - 100 * level ** 2 }).toEqual({ earned: 150, needed: 300 });
  });
});

describe("LevelCooldown", () => {
  it("isolates guild/users and allows after cooldown", () => {
    const limiter = new LevelCooldown(10);
    expect(limiter.accept("g1", "u1", 1000, 5000)).toBe(true);
    expect(limiter.accept("g1", "u1", 5999, 5000)).toBe(false);
    expect(limiter.accept("g2", "u1", 2000, 5000)).toBe(true);
    expect(limiter.accept("g1", "u1", 6000, 5000)).toBe(true);
  });
  it("bounds retained entries", () => {
    const limiter = new LevelCooldown(2);
    limiter.accept("g", "1", 1, 100);
    limiter.accept("g", "2", 1, 100);
    limiter.accept("g", "3", 1, 100);
    expect(limiter.accept("g", "1", 2, 100)).toBe(true);
  });
});
