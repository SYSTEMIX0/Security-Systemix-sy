import { PermissionFlagsBits, SlashCommandBuilder, type GuildMember } from "discord.js";
import { getGuildConfig, isStaffMember, replyEphemeral, systemixEmbed } from "../core/context";
import type { SystemixModule } from "../core/types";

export function missingBotPermissions(input: {
  antiNuke: boolean; lockdown: boolean; autoMod: boolean; moderation: boolean; roleManagement: boolean;
  hasViewAuditLog: boolean; hasManageChannels: boolean; hasManageGuild: boolean;
  hasManageRoles: boolean; hasModerateMembers: boolean; hasKickMembers: boolean; hasBanMembers: boolean;
}): string[] {
  const missing: string[] = [];
  if (input.antiNuke && !input.hasViewAuditLog) missing.push("View Audit Log");
  if (input.lockdown && !input.hasManageChannels) missing.push("Manage Channels");
  if (input.autoMod && !input.hasManageGuild) missing.push("Manage Guild");
  if (input.moderation && !input.hasModerateMembers) missing.push("Moderate Members");
  if (input.moderation && !input.hasKickMembers) missing.push("Kick Members");
  if (input.moderation && !input.hasBanMembers) missing.push("Ban Members");
  if (input.roleManagement && !input.hasManageRoles) missing.push("Manage Roles");
  return [...new Set(missing)];
}

const command = new SlashCommandBuilder()
  .setName("systemix")
  .setDescription("حالة Security Systemix وفحص الجاهزية")
  .addSubcommand((sub) => sub.setName("status").setDescription("عرض ملخص حالة الحماية"))
  .addSubcommand((sub) => sub.setName("doctor").setDescription("فحص أذونات البوت وترتيب التشغيل"));

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "doctor" && !isStaffMember(interaction.member as GuildMember, config)) {
    await replyEphemeral(interaction, "فحص الصلاحيات متاح لمالك السيرفر وفريق الإشراف فقط.");
    return;
  }
  const me = interaction.guild.members.me;
  if (!me) {
    await replyEphemeral(interaction, "لم أستطع جلب عضوية البوت في هذا السيرفر؛ تحقق من وجوده وصلاحياته.");
    return;
  }
  if (subcommand === "status") {
    const enabled = [
      config.antiNuke.enabled && "Anti-Nuke",
      config.antiRaid.enabled && "Anti-Raid",
      config.antiSpam.enabled && "Anti-Spam",
      config.honeypot.enabled && "Honeypot",
      config.autoMod.enabled && "AutoMod",
      config.verification.enabled && "Verification",
    ].filter(Boolean);
    await replyEphemeral(interaction, {
      embeds: [systemixEmbed({
        title: "Security Systemix · الحالة",
        tone: config.mode === "protect" ? "success" : "info",
        description: `الوضع: **${config.mode === "protect" ? "حماية" : "مراقبة فقط"}**\nالوحدات المفعّلة في الإعدادات: ${enabled.length ? enabled.join("، ") : "لا توجد"}\nالبوت موجود في ${interaction.guild.members.me ? "هذا السيرفر" : "غير متصل"}.`,
        fields: [{ name: "تنبيه", value: "الحالة لا تثبت أن كل إذن أو Intent متاح؛ استخدم /systemix doctor لمراجعة الأذونات الأساسية." }],
        config,
      })],
    });
    return;
  }

  const perms = me.permissions;
  const missing = missingBotPermissions({
    antiNuke: config.antiNuke.enabled,
    lockdown: config.antiNuke.lockdownOnTrigger || config.antiRaid.autoLockdown,
    autoMod: config.autoMod.enabled,
    moderation: true,
    roleManagement: config.antiNuke.enabled || config.verification.enabled || config.delegation.enabled,
    hasViewAuditLog: perms.has(PermissionFlagsBits.ViewAuditLog),
    hasManageChannels: perms.has(PermissionFlagsBits.ManageChannels),
    hasManageGuild: perms.has(PermissionFlagsBits.ManageGuild),
    hasManageRoles: perms.has(PermissionFlagsBits.ManageRoles),
    hasModerateMembers: perms.has(PermissionFlagsBits.ModerateMembers),
    hasKickMembers: perms.has(PermissionFlagsBits.KickMembers),
    hasBanMembers: perms.has(PermissionFlagsBits.BanMembers),
  });
  const roleStatus = "تحقق يدوياً من أن رتبة البوت أعلى من كل عضو/رتبة سيُديرها؛ لا يستطيع البوت تجاوز ترتيب Discord.";
  await replyEphemeral(interaction, {
    embeds: [systemixEmbed({
      title: "Systemix Doctor · فحص مبدئي",
      tone: missing.length ? "warning" : "success",
      description: missing.length ? `صلاحيات مفقودة: **${missing.join("، ")}**` : "لا توجد صلاحيات أساسية مفقودة من الفحص العام.",
      fields: [
        { name: "ترتيب الرتب", value: roleStatus },
        { name: "حدود الفحص", value: "يفحص هذا الأمر صلاحيات البوت العامة فقط؛ قد تختلف صلاحية القناة وIntent المميز ونتيجة الإجراء حسب الهدف." },
      ],
      config,
    })],
  });
}

export const systemixModule: SystemixModule = {
  name: "systemix",
  implemented: true,
  commands: [command.toJSON()],
  onCommand,
};
