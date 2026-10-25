import { describe, expect, it } from "vitest";
import { effectiveSubscriptionStatus, subscriptionDurationDays, subscriptionWindow } from "./db";
import { applySubscriptionEntitlement } from "./discord/core/context";
import { defaultGuildSecurityConfig } from "./discord/config";

describe("manual guild subscriptions", () => {
  it("uses exactly 30 days for monthly and 365 days for annual renewals", () => {
    expect(subscriptionDurationDays("monthly")).toBe(30);
    expect(subscriptionDurationDays("annual")).toBe(365);
  });

  it("extends an active entitlement from its current future end instead of shortening it", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    const currentEnd = new Date("2026-11-01T00:00:00.000Z");
    const window = subscriptionWindow({ endsAt: currentEnd }, "monthly", now);
    expect(window.startsAt.toISOString()).toBe(currentEnd.toISOString());
    expect(window.endsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("starts a new period immediately when the existing entitlement has expired", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    const window = subscriptionWindow({ endsAt: new Date("2026-10-24T23:59:59.000Z") }, "annual", now);
    expect(window.startsAt.toISOString()).toBe(now.toISOString());
    expect(window.endsAt.toISOString()).toBe("2027-10-25T00:00:00.000Z");
  });

  it("treats suspension as higher priority than date and expires elapsed active rows", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    expect(effectiveSubscriptionStatus({ status: "suspended", endsAt: new Date("2027-01-01T00:00:00.000Z") }, now)).toBe("suspended");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: new Date("2026-10-24T23:59:59.000Z") }, now)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: new Date("2026-10-25T00:00:01.000Z") }, now)).toBe("active");
  });

  it("forces automated protection into observe mode without an active entitlement", () => {
    const configured = { ...defaultGuildSecurityConfig, mode: "protect" as const };
    expect(applySubscriptionEntitlement(configured, undefined).mode).toBe("observe");
    expect(applySubscriptionEntitlement(configured, {
      guildId: "123456789012345678",
      plan: "annual",
      status: "suspended",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      note: null,
      updatedByDiscordId: "123456789012345678",
      updatedAt: new Date("2026-10-25T00:00:00.000Z"),
    }).mode).toBe("observe");
    expect(applySubscriptionEntitlement(configured, {
      guildId: "123456789012345678",
      plan: "monthly",
      status: "active",
      startsAt: new Date("2026-10-01T00:00:00.000Z"),
      endsAt: new Date("2026-11-01T00:00:00.000Z"),
      note: null,
      updatedByDiscordId: "123456789012345678",
      updatedAt: new Date("2026-10-25T00:00:00.000Z"),
    }).mode).toBe("protect");
  });
});
