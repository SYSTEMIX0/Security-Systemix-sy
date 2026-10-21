import { describe, expect, it } from "vitest";
import {
  defaultGuildSecurityConfig,
  guildSecurityPatchSchema,
  mergeGuildSecurityConfig,
} from "./config";
import { evaluateRaidSignals, isSnowflake, matchesDiscordApplicationId } from "./security";

describe("guild security configuration", () => {
  it("starts in observe-only mode with all enforcement modules disabled", () => {
    expect(defaultGuildSecurityConfig.mode).toBe("observe");
    expect(defaultGuildSecurityConfig.antiNuke.enabled).toBe(false);
    expect(defaultGuildSecurityConfig.antiRaid.enabled).toBe(false);
    expect(defaultGuildSecurityConfig.autoMod.enabled).toBe(false);
  });

  it("merges a partial section without overwriting unrelated safeguards", () => {
    const next = mergeGuildSecurityConfig(defaultGuildSecurityConfig, {
      antiNuke: { enabled: true, threshold: 4 },
    });
    expect(next.antiNuke).toMatchObject({ enabled: true, threshold: 4, windowSeconds: 10 });
    expect(next.antiRaid).toEqual(defaultGuildSecurityConfig.antiRaid);
    expect(next.mode).toBe("observe");
  });

  it("rejects unsupported values rather than silently accepting extra settings", () => {
    expect(guildSecurityPatchSchema.safeParse({ antiNuke: { threshold: 1 } }).success).toBe(false);
    expect(guildSecurityPatchSchema.safeParse({ admin: true }).success).toBe(false);
  });
});

describe("risk signals", () => {
  it("does not treat account age alone as conclusive when age is outside the configured window", () => {
    expect(evaluateRaidSignals({ accountAgeMs: 48 * 60 * 60_000, accountAgeThresholdMs: 24 * 60 * 60_000, joinsInWindow: 1, joinThreshold: 8 }))
      .toEqual({ suspicious: false, signals: [] });
  });

  it("reports burst and new-account signals separately for review", () => {
    expect(evaluateRaidSignals({ accountAgeMs: 1_000, accountAgeThresholdMs: 24 * 60 * 60_000, joinsInWindow: 8, joinThreshold: 8 }))
      .toEqual({ suspicious: true, signals: ["new_account", "join_burst"] });
  });

  it("validates Discord snowflakes without coercing numbers", () => {
    expect(isSnowflake("1562540070802563162")).toBe(true);
    expect(isSnowflake(1562540070802563162)).toBe(false);
  });

  it("rejects a valid bot ID that belongs to a different Discord application", () => {
    expect(matchesDiscordApplicationId("1562540070802563162", "1562540070802563162")).toBe(true);
    expect(matchesDiscordApplicationId("1562540070802563162", "12345678901234567")).toBe(false);
    expect(matchesDiscordApplicationId("not-a-snowflake", "12345678901234567")).toBe(false);
  });
});
