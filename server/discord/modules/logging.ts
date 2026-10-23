import { type AuditLogEvent, type Guild, type GuildAuditLogsEntry, type GuildMember, type Message, type PartialMessage, type PartialGuildMember, type VoiceState } from "discord.js";
import type { GuildSecurityConfig } from "../config";
import { getGuildConfig, recordEvent, sendSecurityAlert, systemixEmbed } from "../core/context";
import type { SystemixModule } from "../core/types";
import { monitoredAuditActionNames } from "../security";

type LogSwitch = "memberJoinLeave" | "messageDelete" | "messageEdit" | "memberRoles" | "nicknames" | "channelChanges" | "roleChanges" | "voice" | "moderation";
export function loggingEnabled(config: GuildSecurityConfig, feature: LogSwitch, channelId?: string | null): boolean {
  return config.logging.enabled && config.logging[feature] && !(channelId && config.logging.ignoredChannelIds.includes(channelId));
}

async function writeLog(guild: Guild, config: GuildSecurityConfig, input: {
  feature: LogSwitch; eventType: string; actorId?: string | null; targetId?: string | null;
  severity?: "low" | "medium" | "high"; channelId?: string | null;
  details: Record<string, string | number | boolean | string[] | null>;
  title: string; fields: Array<{ name: string; value: string; inline?: boolean }>;
}): Promise<void> {
  if (!loggingEnabled(config, input.feature, input.channelId)) return;
  await recordEvent({
    guildId: guild.id, eventType: `logging:${input.eventType}`,
    actorId: input.actorId ?? null, targetId: input.targetId ?? null,
    severity: input.severity ?? "low", details: input.details,
  });
  if (config.logging.channelId) {
    await sendSecurityAlert(guild, config, config.logging.channelId, {
      embeds: [systemixEmbed({ title: input.title, tone: input.severity === "high" ? "danger" : input.severity === "medium" ? "warning" : "info", fields: input.fields, config })],
      allowedMentions: { parse: [] },
    });
  }
}

async function onMemberAdd(member: GuildMember): Promise<void> {
  const config = await getGuildConfig(member.guild.id);
  await writeLog(member.guild, config, {
    feature: "memberJoinLeave", eventType: "member_join", targetId: member.id,
    title: "انضم عضو", fields: [{ name: "معرّف العضو", value: `\`${member.id}\`` }],
    details: { memberId: member.id, accountAgeHours: Math.floor(Math.max(0, Date.now() - member.user.createdTimestamp) / 3_600_000) },
  });
}

async function onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const guild = member.guild;
  const config = await getGuildConfig(guild.id);
  await writeLog(guild, config, {
    feature: "memberJoinLeave", eventType: "member_leave", targetId: member.id,
    title: "غادر عضو", severity: "medium", fields: [{ name: "معرّف العضو", value: `\`${member.id}\`` }],
    details: { memberId: member.id },
  });
}

async function onMessageDelete(message: Message<true> | PartialMessage): Promise<void> {
  const guildId = message.guildId;
  if (!guildId) return;
  const guild = message.guild;
  if (!guild) return;
  const config = await getGuildConfig(guildId);
  await writeLog(guild, config, {
    feature: "messageDelete", eventType: "message_delete", actorId: null, targetId: message.author?.id ?? null,
    channelId: message.channelId, title: "حُذفت رسالة",
    fields: [{ name: "القناة / الرسالة", value: `\`${message.channelId}\` / \`${message.id}\`` }, { name: "الكاتب", value: message.author?.id ? `\`${message.author.id}\`` : "غير متاح" }],
    severity: "medium", details: { messageId: message.id, channelId: message.channelId, authorId: message.author?.id ?? null },
  });
}

async function onMessageUpdate(before: Message<true> | PartialMessage, after: Message<true>): Promise<void> {
  const config = await getGuildConfig(after.guildId);
  await writeLog(after.guild, config, {
    feature: "messageEdit", eventType: "message_edit", targetId: after.author.id, channelId: after.channelId,
    title: "عُدّلت رسالة",
    fields: [{ name: "القناة / الرسالة", value: `\`${after.channelId}\` / \`${after.id}\`` }, { name: "الكاتب", value: `\`${after.author.id}\`` }],
    details: { messageId: after.id, channelId: after.channelId, authorId: after.author.id, contentChanged: before.content !== after.content },
  });
}

async function onMemberUpdate(before: GuildMember | PartialGuildMember, after: GuildMember): Promise<void> {
  const config = await getGuildConfig(after.guild.id);
  const beforeNickname = before.nickname ?? null;
  const afterNickname = after.nickname ?? null;
  const beforeRoleIds = new Set(before.roles.cache.keys());
  const afterRoleIds = new Set(after.roles.cache.keys());
  const added = [...afterRoleIds].filter((id) => !beforeRoleIds.has(id));
  const removed = [...beforeRoleIds].filter((id) => !afterRoleIds.has(id));
  if (config.logging.memberRoles && (added.length || removed.length)) {
    await writeLog(after.guild, config, {
      feature: "memberRoles", eventType: "member_roles_update", targetId: after.id,
      title: "تغيّرت رتب عضو",
      fields: [{ name: "العضو", value: `\`${after.id}\`` }, { name: "أضيفت", value: added.map((id) => `\`${id}\``).join(", ") || "—" }, { name: "أزيلت", value: removed.map((id) => `\`${id}\``).join(", ") || "—" }],
      details: { memberId: after.id, addedRoleIds: added.slice(0, 25), removedRoleIds: removed.slice(0, 25) },
    });
  }
  if (config.logging.nicknames && beforeNickname !== afterNickname) {
    await writeLog(after.guild, config, {
      feature: "nicknames", eventType: "member_nickname_update", targetId: after.id,
      title: "تغيّر اسم عرض عضو",
      fields: [{ name: "العضو", value: `\`${after.id}\`` }, { name: "التغيير", value: "تم تحديث الاسم (لا يُحفظ نص الاسم حفاظاً على الخصوصية)." }],
      details: { memberId: after.id, nicknameChanged: true },
    });
  }
}

async function onAuditLog(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
  const config = await getGuildConfig(guild.id);
  const action = monitoredAuditActionNames.get(entry.action as AuditLogEvent);
  if (!action) return;
  const channelChange = action.startsWith("channel_");
  const roleChange = action.startsWith("role_");
  const moderation = ["member_kick", "member_ban", "member_prune", "member_role_update", "bot_add"].includes(action);
  const feature: LogSwitch = channelChange ? "channelChanges" : roleChange ? "roleChanges" : "moderation";
  if (!(channelChange || roleChange || moderation)) return;
  await writeLog(guild, config, {
    feature, eventType: `audit_${action}`, actorId: entry.executorId, targetId: entry.targetId,
    title: "تغيير إداري في Discord",
    fields: [
      { name: "الحدث", value: action, inline: true },
      { name: "المنفذ", value: entry.executorId ? `\`${entry.executorId}\`` : "غير متاح", inline: true },
      { name: "المستهدف", value: entry.targetId ? `\`${entry.targetId}\`` : "غير متاح", inline: true },
    ],
    severity: action.endsWith("_delete") || action === "member_ban" ? "medium" : "low",
    details: { action, auditEntryId: entry.id, targetId: entry.targetId },
  });
}

async function onVoiceState(before: VoiceState, after: VoiceState): Promise<void> {
  const guild = after.guild;
  const config = await getGuildConfig(guild.id);
  if (before.channelId === after.channelId) return;
  const memberId = after.id;
  const channelId = after.channelId ?? before.channelId;
  await writeLog(guild, config, {
    feature: "voice", eventType: "voice_channel_change", targetId: memberId, channelId,
    title: "تغيّر اتصال صوتي",
    fields: [{ name: "العضو", value: `\`${memberId}\`` }, { name: "من", value: before.channelId ? `\`${before.channelId}\`` : "—", inline: true }, { name: "إلى", value: after.channelId ? `\`${after.channelId}\`` : "—", inline: true }],
    details: { memberId, beforeChannelId: before.channelId, afterChannelId: after.channelId },
  });
}

export const loggingModule: SystemixModule = {
  name: "logging",
  implemented: true,
  onMemberAdd,
  onMemberRemove,
  onMessageDelete,
  onMessageUpdate,
  onMemberUpdate,
  onAuditLog,
  onVoiceState,
};
