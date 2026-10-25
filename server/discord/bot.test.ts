import { describe, expect, it } from "vitest";
import { configuredCommandGuildIds, getIntentPlans } from "./bot";

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
