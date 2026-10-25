import { describe, expect, it } from "vitest";
import { defaultGuildSecurityConfig } from "../config";
import { loggingDestination, loggingEnabled, SYSTEMIX_LOG_CHANNELS } from "./logging";

describe("privacy-conscious logging switches", () => {
  it("requires both module and event switches and respects ignored channels", () => {
    const config = {
      ...defaultGuildSecurityConfig,
      logging: { ...defaultGuildSecurityConfig.logging, enabled: true, messageDelete: true, ignoredChannelIds: ["ignored"] },
    };
    expect(loggingEnabled(config, "messageDelete", "safe")).toBe(true);
    expect(loggingEnabled(config, "messageDelete", "ignored")).toBe(false);
    expect(loggingEnabled({ ...config, logging: { ...config.logging, enabled: false } }, "messageDelete")).toBe(false);
  });

  it("routes each enabled log family to its dedicated private channel", () => {
    const config = {
      ...defaultGuildSecurityConfig,
      general: { ...defaultGuildSecurityConfig.general, securityLogChannelId: "fallback" },
      logging: {
        ...defaultGuildSecurityConfig.logging,
        channelId: "fallback",
        memberChannelId: "members",
        messageChannelId: "messages",
        securityChannelId: "security",
        voiceChannelId: "voice",
      },
    };
    expect(loggingDestination(config, "memberJoinLeave")).toBe("members");
    expect(loggingDestination(config, "messageDelete")).toBe("messages");
    expect(loggingDestination(config, "roleChanges")).toBe("security");
    expect(loggingDestination(config, "voice")).toBe("voice");
    expect(Object.values(SYSTEMIX_LOG_CHANNELS)).toEqual([
      "👥・member-logs", "💬・message-logs", "🛡️・security-logs", "🔊・voice-logs",
    ]);
  });
});
