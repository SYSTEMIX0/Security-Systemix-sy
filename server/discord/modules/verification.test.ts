import { describe, expect, it } from "vitest";
import { canVerifyMember } from "./verification";

describe("verification eligibility", () => {
  it("allows the configured button only in its channel and after the age gate", () => {
    expect(canVerifyMember({ enabled: true, mode: "button", channelMatches: true, ageHours: 72, minAgeHours: 24 })).toEqual({ allowed: true, reason: "ok" });
    expect(canVerifyMember({ enabled: true, mode: "button", channelMatches: false, ageHours: 72, minAgeHours: 24 }).reason).toBe("wrong_channel");
  });

  it("does not claim an external CAPTCHA provider exists", () => {
    expect(canVerifyMember({ enabled: true, mode: "captcha", channelMatches: true, ageHours: 72, minAgeHours: 0 })).toEqual({ allowed: false, reason: "unsupported_mode" });
    expect(canVerifyMember({ enabled: false, mode: "button", channelMatches: true, ageHours: 72, minAgeHours: 0 }).reason).toBe("disabled");
  });
});
