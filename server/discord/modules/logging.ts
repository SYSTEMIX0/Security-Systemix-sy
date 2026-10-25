import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type TextChannel,
  type VoiceState,
} from "discord.js";
import { mergeGuildSecurityConfig, type GuildSecurityConfig } from "../config";
import { getGuildConfig, recordEvent, sendSecurityAlert, systemixEmbed } from "../core/context";
import type { SystemixModule } from "../core/types";
import { monitoredAuditActionNames } from "../security";
import { recordSecurityEvent, upsertGuildSecuritySettings } from "../../db";

type LogSwitch = "memberJoinLeave" | "messageDelete" | "messageEdit" | "memberRoles" | "nicknames" | "channelChanges" | "roleChanges" | "voice" | "moderation";

/** Four private Discord channels created by `/logs setup`. */
export const SYSTEMIX_LOG_CHANNELS = {
  member: "👥・member-logs",
  message: "💬・message-logs",
  security: "🛡️・security-logs",
  voice: "🔊・voice-logs",
} as const;

const LOG_CATEGORY_NAME = "📋・systemix-logs";

export function loggingEnabled(config: GuildSecurityConfig, feature: LogSwitch, channelId?: string | null): boolean {
  return config.logging.enabled && config.logging[feature] && !(channelId && config.logging.ignoredChannelIds.includes(channelId));
}

/** Dedicated routes are optional, preserving the single-channel fallback for existing servers. */
export function loggingDestination(config: GuildSecurityConfig, feature: LogSwitch): string | null {
  const specialised = feature === "memberJoinLeave" ? config.logging.memberChannelId
    : feature === "messageDelete" || feature === "messageEdit" ? config.logging.messageChannelId
      : feature === "voice" ? config.logging.voiceChannelId
        : config.logging.securityChannelId;
  return specialised ?? config.logging.channelId ?? config.general.securityLogChannelId;
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
  const destination = loggingDestination(config, input.feature);
  if (destination) {
    await sendSecurityAlert(guild, config, destination, {
      embeds: [systemixEmbed({ title: input.title, tone: input.severity === "high" ? "danger" : input.severity === "medium" ? "warning" : "info", fields: input.fields, config })],
      allowedMentions: { parse: [] },
    });
  }
}

function logsCommand(name: "logs" | "systemix-logs") {
  return new SlashCommandBuilder().setName(name).setDescription("إعداد قنوات سجل Systemix")
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("إنشاء وربط قنوات اللوقات تلقائياً"));
}

const command = logsCommand("logs");
const systemixLogsCommand = logsCommand("systemix-logs");

type LogCommandInteraction = Parameters<NonNullable<SystemixModule["onCommand"]>>[0];

async function respond(interaction: LogCommandInteraction, content: string): Promise<void> {
  try {
    if (interaction.deferred) await interaction.editReply({ content, allowedMentions: { parse: [] } });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  } catch {
    // Avoid leaking a Discord interaction error after the requested setup was already audited.
  }
}

function findLogCategory(guild: Guild) {
  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildCategory) return false;
    const name = channel.name.toLowerCase();
    return channel.name === LOG_CATEGORY_NAME || name.includes("log") || channel.name.includes("السجلات");
  }) ?? null;
}

function findLogChannel(guild: Guild, categoryId: string, name: string): TextChannel | null {
  return (guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.parentId === categoryId && channel.name === name) ?? null) as TextChannel | null;
}

async function setupLogs(interaction: LogCommandInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.member as GuildMember;
  if (member.id !== interaction.guild.ownerId && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return respond(interaction, "هذا الأمر مخصص لمالك السيرفر أو من يملك صلاحية Manage Server.");
  }
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.SendMessages)) {
    return respond(interaction, "لا يملك البوت حالياً Manage Channels وSend Messages. أعطه هاتين الصلاحيتين ثم أعد /systemix-logs setup.");
  }
  try {
    // The audit precondition is intentionally completed before creating any channels.
    await recordSecurityEvent({
      guildId: interaction.guildId,
      eventType: "logging:setup_precondition",
      actorId: member.id,
      severity: "medium",
      details: { requested: "four_private_log_channels" },
    });
  } catch {
    return respond(interaction, "تعذر توثيق إعداد اللوقات في سجل التدقيق؛ لم يتم إنشاء أي قناة.");
  }

  const createdChannels: TextChannel[] = [];
  let createdCategory: { delete: (reason?: string) => Promise<unknown> } | null = null;
  try {
    let category = findLogCategory(interaction.guild);
    const managerRoleIds = [...interaction.guild.roles.cache.values()]
      .filter((role) => !role.managed && (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageGuild)))
      .slice(0, 20)
      .map((role) => role.id);
    if (!category) {
      category = await interaction.guild.channels.create({
        name: LOG_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ...managerRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
        ],
        reason: "Security Systemix log setup",
      });
      createdCategory = category;
    }

    const channels = {} as Record<keyof typeof SYSTEMIX_LOG_CHANNELS, TextChannel>;
    for (const [key, name] of Object.entries(SYSTEMIX_LOG_CHANNELS) as Array<[keyof typeof SYSTEMIX_LOG_CHANNELS, string]>) {
      let channel = findLogChannel(interaction.guild, category.id, name);
      if (!channel) {
        channel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: "Security Systemix log channel" }) as TextChannel;
        createdChannels.push(channel);
      }
      channels[key] = channel;
    }

    const current = await getGuildConfig(interaction.guildId);
    const next = mergeGuildSecurityConfig(current, {
      general: { modLogChannelId: channels.security.id, securityLogChannelId: channels.security.id },
      logging: {
        enabled: true,
        channelId: channels.security.id,
        memberChannelId: channels.member.id,
        messageChannelId: channels.message.id,
        securityChannelId: channels.security.id,
        voiceChannelId: channels.voice.id,
        memberJoinLeave: true,
        messageDelete: true,
        messageEdit: true,
        memberRoles: true,
        nicknames: true,
        channelChanges: true,
        roleChanges: true,
        voice: true,
        moderation: true,
        ignoredChannelIds: Object.values(channels).map((channel) => channel.id),
      },
    });
    await upsertGuildSecuritySettings(interaction.guildId, member.id, next);
    await channels.security.send({
      embeds: [systemixEmbed({
        title: "تم تشغيل اللوقات",
        description: "تم ربط قنوات العضوية والرسائل والحماية والصوت. هذه القنوات للقراءة فقط وتبدأ بإظهار الأحداث الجديدة.",
        tone: "success",
        config: next,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return respond(interaction, "تم إنشاء وربط 4 قنوات لوق خاصة: أعضاء، رسائل، حماية، وصوت.");
  } catch {
    await Promise.allSettled(createdChannels.map((channel) => channel.delete("Rolling back incomplete Systemix log setup")));
    if (createdCategory) await createdCategory.delete("Rolling back incomplete Systemix log setup").catch(() => undefined);
    return respond(interaction, "لم يكتمل إعداد اللوقات. راجع صلاحيات Manage Channels وSend Messages ثم أعد /systemix-logs setup؛ نُظفت القنوات الجديدة إن أمكن.");
  }
}

export type LogProvisionResult = { createdChannels: number; reusedCategory: boolean };

/** Owner-panel equivalent of `/systemix-logs setup`, without trusting a browser command cache. */
export async function provisionLogsForGuild(guild: Guild, actorId: string): Promise<LogProvisionResult> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error("bot_missing_log_setup_permissions");
  }
  await recordSecurityEvent({
    guildId: guild.id,
    eventType: "logging:owner_setup_precondition",
    actorId,
    severity: "medium",
    details: { requested: "four_private_log_channels" },
  });

  const createdChannels: TextChannel[] = [];
  let createdCategory: { delete: (reason?: string) => Promise<unknown> } | null = null;
  const existingCategory = findLogCategory(guild);
  try {
    const category = existingCategory ?? await guild.channels.create({
      name: LOG_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ...[...guild.roles.cache.values()]
          .filter((role) => !role.managed && (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageGuild)))
          .slice(0, 20)
          .map((role) => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
      ],
      reason: "Security Systemix owner log setup",
    });
    if (!existingCategory) createdCategory = category;

    const channels = {} as Record<keyof typeof SYSTEMIX_LOG_CHANNELS, TextChannel>;
    for (const [key, name] of Object.entries(SYSTEMIX_LOG_CHANNELS) as Array<[keyof typeof SYSTEMIX_LOG_CHANNELS, string]>) {
      let channel = findLogChannel(guild, category.id, name);
      if (!channel) {
        channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: "Security Systemix owner log channel" }) as TextChannel;
        createdChannels.push(channel);
      }
      channels[key] = channel;
    }
    const current = await getGuildConfig(guild.id);
    const next = mergeGuildSecurityConfig(current, {
      general: { modLogChannelId: channels.security.id, securityLogChannelId: channels.security.id },
      logging: {
        enabled: true, channelId: channels.security.id, memberChannelId: channels.member.id,
        messageChannelId: channels.message.id, securityChannelId: channels.security.id, voiceChannelId: channels.voice.id,
        memberJoinLeave: true, messageDelete: true, messageEdit: true, memberRoles: true, nicknames: true,
        channelChanges: true, roleChanges: true, voice: true, moderation: true,
        ignoredChannelIds: Object.values(channels).map((channel) => channel.id),
      },
    });
    await upsertGuildSecuritySettings(guild.id, actorId, next);
    await channels.security.send({
      embeds: [systemixEmbed({ title: "تم تشغيل اللوقات", description: "تم ربط قنوات العضوية والرسائل والحماية والصوت.", tone: "success", config: next })],
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
    return { createdChannels: createdChannels.length, reusedCategory: Boolean(existingCategory) };
  } catch (error) {
    await Promise.allSettled(createdChannels.map((channel) => channel.delete("Rolling back incomplete Systemix owner log setup")));
    if (createdCategory) await createdCategory.delete("Rolling back incomplete Systemix owner log setup").catch(() => undefined);
    throw error;
  }
}

async function handleCommand(interaction: LogCommandInteraction): Promise<void> {
  // An older `/logs channel` registration can remain visible briefly in Discord clients.
  // Treat it as the safe setup request too, rather than ignoring the owner's command.
  if (interaction.commandName === "logs" || interaction.commandName === "systemix-logs") await setupLogs(interaction);
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
  commands: [command.toJSON(), systemixLogsCommand.toJSON()],
  onCommand: handleCommand,
  onMemberAdd,
  onMemberRemove,
  onMessageDelete,
  onMessageUpdate,
  onMemberUpdate,
  onAuditLog,
  onVoiceState,
};
