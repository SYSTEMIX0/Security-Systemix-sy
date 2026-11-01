import { describe, expect, it } from "vitest";
import { configuredCommandGuildIds, gatewayRetryDelayMs, getIntentPlans } from "./bot";

describe("Discord privileged intent negotiation", () => {
  it("tries both intents, each independently, then a safe base set by default", () => {
    expect(getIntentPlans(undefined)).toEqual([
      { members: true, content: true },
      { members: true, content: false },
      { members: false, content: true },
      { members: false, content: false },
    ]);
  });

  it("supports an explicit members-only policy", () => {
    expect(getIntentPlans("members")).toEqual([
      { members: true, content: false },
      { members: false, content: false },
    ]);
  });

  it("supports disabling privileged intents entirely", () => {
    expect(getIntentPlans("none")).toEqual([{ members: false, content: false }]);
  });

  it("accepts only distinct Discord snowflakes as optional command-sync Guilds", () => {
    expect(configuredCommandGuildIds("1553290738056433704, invalid,1553290738056433704,123")).toEqual(["1553290738056433704"]);
  });
});

describe("Discord Gateway retry backoff", () => {
  it("backs off exponentially and caps retry delay at one minute", () => {
    expect([1, 2, 3, 4, 5, 6].map(gatewayRetryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it("uses the first retry delay for invalid attempt values", () => {
    expect(gatewayRetryDelayMs(Number.NaN)).toBe(5_000);
  });
});
