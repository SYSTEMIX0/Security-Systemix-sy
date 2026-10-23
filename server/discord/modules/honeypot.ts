import { PermissionFlagsBits, type GuildMember, type Message, type MessageCreateOptions } from "discord.js";
import type { GuildSecurityConfig } from "../config";
import {
  actorOutranks,
  enforcementEnabled,
  getGuildConfig,
  isTrustedActor,
  logSafe,
  recordCase,
  recordEvent,
  sendSecurityAlert,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { setCaseActive, updateCaseReason } from "../store/cases";

export function isHoneypotMessage(enabled: boolean, configuredChannelId: string | null, actualChannelId: string): boolean {
  return enabled && Boolean(configuredChannelId) && configuredChannelId === actualChannelId;
}

function alertPayload(memberId: string, channelId: string, config: GuildSecurityConfig, protectedMode: boolean): MessageCreateOptions {
  return {
    embeds: [systemixEmbed({
      title: "تم تفعيل قناة الطُعم",
      tone: protectedMode ? "danger" : "warning",
      description: protectedMode ? "تم تنفيذ السياسة المحددة مع احترام صلاحيات Discord وترتيب الأدوار." : "وضع المراقبة فقط: لم تُحذف الرسالة ولم تُطبق عقوبة.",
      fields: [
        { name: "العضو", value: `\`${memberId}\``, inline: true },
        { name: "القناة", value: `\`${channelId}\``, inline: true },
      ],
      config,
    })],
    allowedMentions: { parse: [] },
  };
}

async function applyAction(message: Message<true>, member: GuildMember, config: GuildSecurityConfig): Promise<{ applied: boolean; result: string }> {
  const me = message.guild.members.me;
  if (!me || !actorOutranks(me, member)) return { applied: false, result: "hierarchy_guard" };
  const reason = "Security Systemix Honeypot policy";
  try {
    switch (config.honeypot.action) {
      case "timeout":
        if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return { applied: false, result: "missing_moderate_members" };
        await member.timeout(config.honeypot.timeoutMinutes * 60_000, reason);
        return { applied: true, result: "timeout" };
      case "kick":
        if (!me.permissions.has(PermissionFlagsBits.KickMembers)) return { applied: false, result: "missing_kick_members" };
        await member.kick(reason);
        return { applied: true, result: "kick" };
      case "ban":
        if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return { applied: false, result: "missing_ban_members" };
        await member.ban({ reason });
        return { applied: true, result: "ban" };
    }
  } catch (error) {
    logSafe(`Honeypot action failed for guild ${message.guildId}`, error);
    return { applied: false, result: "discord_action_failed" };
  }
}

async function onMessage(message: Message<true>): Promise<void> {
  const config = await getGuildConfig(message.guildId);
  if (message.author.bot || !isHoneypotMessage(config.honeypot.enabled, config.honeypot.channelId, message.channelId)) return;
  const member = message.member;
  if (!member || isTrustedActor(member, config, config.general.staffRoleIds)) return;
  const protectedMode = enforcementEnabled(config);
  const signalSaved = await recordEvent({
    guildId: message.guildId,
    eventType: "honeypot:triggered",
    actorId: member.id,
    targetId: null,
    severity: protectedMode ? "high" : "medium",
    details: { channelId: message.channelId, messageId: message.id, configuredAction: config.honeypot.action, mode: config.mode },
  });
  if (!signalSaved) return;
  await sendSecurityAlert(message.guild, config, config.general.securityLogChannelId,
    alertPayload(member.id, message.channelId, config, protectedMode));
  if (!protectedMode) return;

  const caseRow = await recordCase(message.guild, config, {
    type: "honeypot", targetId: member.id, moderatorId: message.client.user?.id ?? "0",
    reason: "سياسة قناة الطُعم قيد التنفيذ.", source: "auto", active: false,
    metadata: { channelId: message.channelId, messageId: message.id, status: "pending" },
  });
  if (!caseRow) return;

  if (config.honeypot.deleteMessage) {
    const me = message.guild.members.me;
    if (me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.delete().catch((error) => logSafe(`Honeypot message delete failed in guild ${message.guildId}`, error));
    } else {
      await recordEvent({
        guildId: message.guildId, eventType: "honeypot:delete_blocked", actorId: member.id, targetId: null,
        severity: "medium", details: { reason: "missing_manage_messages" },
      });
    }
  }

  const outcome = await applyAction(message, member, config);
  await updateCaseReason(message.guildId, caseRow.caseNumber, `تم رصد قناة الطُعم · ${outcome.result}`);
  if (!outcome.applied) {
    await recordEvent({
      guildId: message.guildId, eventType: "honeypot:action_blocked", actorId: member.id, targetId: null,
      severity: "high", details: { action: config.honeypot.action, result: outcome.result },
    });
    return;
  }
  if (outcome.result === "timeout") await setCaseActive(message.guildId, caseRow.caseNumber, true);
}

export const honeypotModule: SystemixModule = {
  name: "honeypot",
  implemented: true,
  onMessage,
};
