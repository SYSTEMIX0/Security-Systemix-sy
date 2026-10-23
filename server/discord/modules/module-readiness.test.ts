import { describe, expect, it } from "vitest";
import { getProductModuleReadiness } from "../../../client/src/lib/module-readiness";

describe("product module readiness", () => {
  it("reports security code as implemented without claiming live Guild activation", () => {
    const readiness = getProductModuleReadiness("defense-core", [
      "antiNuke", "antiRaid", "antiSpam", "autoMod", "honeypot", "lockdown", "moderation", "logging", "verification",
    ]);

    expect(readiness.tone).toBe("implemented");
    expect(readiness.detail).toContain("لا يعني تفعيلها على Guild");
  });

  it("reports incomplete coverage as partial", () => {
    const readiness = getProductModuleReadiness("onboarding", ["welcome", "verification"]);

    expect(readiness.tone).toBe("partial");
    expect(readiness.detail).toContain("CAPTCHA الخارجية غير موجود");
  });

  it("does not equate giveaways with a Discord RSVP events module", () => {
    const readiness = getProductModuleReadiness("events", ["giveaways"]);

    expect(readiness.tone).toBe("planned");
    expect(readiness.detail).toContain("السحوبات ليست وحدة فعاليات RSVP");
  });

  it("treats unknown catalog entries as planned rather than connected", () => {
    const readiness = getProductModuleReadiness("some-future-module", ["utility"]);

    expect(readiness.tone).toBe("planned");
    expect(readiness.label).toBe("مخطط فقط");
  });
});
