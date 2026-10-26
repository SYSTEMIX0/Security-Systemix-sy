import { describe, expect, it } from "vitest";
import {
  defaultGuildSecurityConfig,
  guildSecurityPatchSchema,
  mergeGuildSecurityConfig,
  normalizeGuildSecurityConfig,
} from "./config";
import { evaluateRaidSignals, isSnowflake, matchesDiscordApplicationId } from "./security";

describe("guild security configuration", () => {
  it("starts in observe-only mode with all enforcement modules disabled", () => {
    expect(defaultGuildSecurityConfig.mode).toBe("observe");
    expect(defaultGuildSecurityConfig.antiNuke.enabled).toBe(false);
    expect(defaultGuildSecurityConfig.antiRaid.enabled).toBe(false);
    expect(defaultGuildSecurityConfig.autoMod.enabled).toBe(false);
    expect(defaultGuildSecurityConfig.tickets.transcriptEnabled).toBe(false);
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

  it("accepts only HTTPS URLs for an optional welcome image", () => {
    expect(guildSecurityPatchSchema.safeParse({ welcome: { imageUrl: "https://cdn.example.com/welcome.png" } }).success).toBe(true);
    expect(guildSecurityPatchSchema.safeParse({ welcome: { imageUrl: "http://cdn.example.com/welcome.png" } }).success).toBe(false);
    expect(guildSecurityPatchSchema.safeParse({ welcome: { imageUrl: "javascript:alert(1)" } }).success).toBe(false);
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
    expect(isSnowflake("1553314620477804544")).toBe(true);
    expect(isSnowflake(1553314620477804544)).toBe(false);
  });

  it("rejects a valid bot ID that belongs to a different Discord application", () => {
    expect(matchesDiscordApplicationId("1553314620477804544", "1553314620477804544")).toBe(true);
    expect(matchesDiscordApplicationId("1553314620477804544", "12345678901234567")).toBe(false);
    expect(matchesDiscordApplicationId("not-a-snowflake", "12345678901234567")).toBe(false);
  });
});

describe("ticket topic upgrade", () => {
  it("replaces old preview defaults with the commercial ticket centre topics", () => {
    const config = normalizeGuildSecurityConfig({
      tickets: {
        topics: [
          { id: "support", label: "دعم عام", emoji: "🛟", description: "سؤال" },
          { id: "report", label: "بلاغ", emoji: "🚨", description: "بلاغ" },
        ],
      },
    });
    expect(config.tickets.topics).toEqual(defaultGuildSecurityConfig.tickets.topics);
  });

  it("upgrades the previous three standard topics but preserves custom owner topics", () => {
    const upgraded = normalizeGuildSecurityConfig({
      tickets: {
        topics: ["open-ticket", "middleman-ticket", "levelup-ticket"].map((id) => ({ id, label: id, emoji: "🎫", description: id })),
      },
    });
    expect(upgraded.tickets.topics).toEqual(defaultGuildSecurityConfig.tickets.topics);

    const custom = normalizeGuildSecurityConfig({
      tickets: { topics: [{ id: "admin-complaint", label: "شكوى على إداري", emoji: "📣", description: "خاص" }] },
    });
    expect(custom.tickets.topics).toEqual([{ id: "admin-complaint", label: "شكوى على إداري", emoji: "📣", description: "خاص" }]);
  });
});
