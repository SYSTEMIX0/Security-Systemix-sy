import { readFile } from "node:fs/promises";
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
        ticketChannelId: "tickets",
      },
    };
    expect(loggingDestination(config, "memberJoinLeave")).toBe("members");
    expect(loggingDestination(config, "messageDelete")).toBe("messages");
    expect(loggingDestination(config, "roleChanges")).toBe("security");
    expect(loggingDestination(config, "voice")).toBe("voice");
    expect(loggingDestination(config, "ticketEvents")).toBe("tickets");
    expect(Object.values(SYSTEMIX_LOG_CHANNELS)).toEqual([
      "👥・member-logs", "💬・message-logs", "🛡️・security-logs", "🔊・voice-logs", "🎟️・ticket-logs",
    ]);
  });

  it("keeps a unique Systemix logs command when an old /logs command exists", async () => {
    const source = await readFile("server/discord/modules/logging.ts", "utf8");
    expect(source).toContain('logsCommand("systemix-logs")');
    expect(source).toContain('interaction.commandName === "logs"');
  });

  it("does not reuse a private log category that the bot cannot access", async () => {
    const source = await readFile("server/discord/modules/logging.ts", "utf8");
    expect(source).toContain("hasCategorySetupAccess(channel, member)");
    expect(source).toContain("PermissionFlagsBits.ViewChannel");
  });

  it("fetches the bot member after a fresh invite when the Gateway member cache is empty", async () => {
    const source = await readFile("server/discord/modules/logging.ts", "utf8");
    expect(source).toContain("guild.members.fetchMe()");
    expect(source).toContain("await resolveBotMember(guild)");
    expect(source).toContain("LOG_BOT_CHANNEL_PERMISSIONS");
    expect(source).toContain("PermissionFlagsBits.EmbedLinks");
    expect(source).toContain("ensureLogBotPermissions(category, me.id)");
  });
});
