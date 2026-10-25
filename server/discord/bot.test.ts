import { describe, expect, it } from "vitest";
import { getIntentPlans } from "./bot";

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
});
