import { PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type MessageCreateOptions } from "discord.js";
import {
  actorOutranks,
  dmMember,
  formatDuration,
  getGuildConfig,
  isStaffMember,
  logSafe,
  recordCase,
  recordEvent,
  replyEphemeral,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { clearWarnings, closeActiveTimeoutCases, countActiveWarnings, listCases, setCaseActive, updateCaseReason } from "../store/cases";

export type EscalationAction = "timeout" | "kick" | "ban";
export function chooseEscalationAction(warnings: number, escalation: {
  enabled: boolean; timeoutAt: number; kickAt: number; banAt: number;
}): EscalationAction | null {
  if (!escalation.enabled) return null;
  if (escalation.banAt > 0 && warnings >= escalation.banAt) return "ban";
  if (escalation.kickAt > 0 && warnings >= escalation.kickAt) return "kick";
  if (escalation.timeoutAt > 0 && warnings >= escalation.timeoutAt) return "timeout";
  return null;
}

const command = new SlashCommandBuilder()
  .setName("mod")
  .setDescription("أدوات الإشراف وقضايا الأعضاء")
  .addSubcommand((sub) => sub.setName("warn").setDescription("تسجيل تحذير لعضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("timeout").setDescription("إسكات عضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("duration").setDescription("مثال: 15m أو 2h أو 1d").setRequired(true).setMaxLength(20))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("untimeout").setDescription("إزالة الإسكات عن عضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("kick").setDescription("طرد عضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("ban").setDescription("حظر عضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("warnings").setDescription("عرض تحذيرات عضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true)))
  .addSubcommand((sub) => sub.setName("clear-warnings").setDescription("مسح التحذيرات النشطة لعضو")
    .addUserOption((option) => option.setName("target").setDescription("العضو").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)));

function reasonFor(config: Awaited<ReturnType<typeof getGuildConfig>>, raw: string | null): string | null {
  const reason = raw?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() ?? "";
  if (config.moderation.requireReason && !reason) return null;
  return (reason || "بدون سبب مقدم").slice(0, 300);
}

function actionAllowedByBot(target: GuildMember, permission: bigint): boolean {
  const me = target.guild.members.me;
  return Boolean(me?.permissions.has(permission) && actorOutranks(me, target));
}

async function executeAction(target: GuildMember, action: EscalationAction | "timeout" | "untimeout", reason: string, durationSeconds: number | null, banDeleteDays: number) {
  if (action === "untimeout") {
    if (!actionAllowedByBot(target, PermissionFlagsBits.ModerateMembers)) return false;
    await target.timeout(null, reason);
    return true;
  }
  if (action === "timeout") {
    if (!durationSeconds || durationSeconds > 28 * 24 * 60 * 60 || !actionAllowedByBot(target, PermissionFlagsBits.ModerateMembers)) return false;
    await target.timeout(durationSeconds * 1_000, reason);
    return true;
  }
  if (action === "kick") {
    if (!actionAllowedByBot(target, PermissionFlagsBits.KickMembers)) return false;
    await target.kick(reason);
    return true;
  }
  if (!actionAllowedByBot(target, PermissionFlagsBits.BanMembers)) return false;
  await target.ban({ reason, deleteMessageSeconds: banDeleteDays * 86_400 });
  return true;
}

async function dmAction(target: GuildMember, action: string, reason: string, durationSeconds: number | null): Promise<void> {
  if (!target.guild) return;
  const payload: MessageCreateOptions = {
    embeds: [systemixEmbed({
      title: "إجراء إشرافي في السيرفر",
      tone: "warning",
      fields: [
        { name: "الإجراء", value: action, inline: true },
        ...(durationSeconds ? [{ name: "المدة", value: formatDuration(durationSeconds), inline: true }] : []),
        { name: "السبب", value: reason },
      ],
    })],
    allowedMentions: { parse: [] },
  };
  await dmMember(target, payload);
}

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  const actor = interaction.member as GuildMember;
  if (!isStaffMember(actor, config)) {
    await replyEphemeral(interaction, "هذا الأمر مخصص لمالك السيرفر أو فريق الإشراف المصرح.");
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  const user = interaction.options.getUser("target", true);
  if (user.bot) {
    await replyEphemeral(interaction, "هذا الأمر مخصص للأعضاء؛ لا يمكن استهداف حسابات البوتات بهذه الوحدة.");
    return;
  }
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) {
    await replyEphemeral(interaction, "العضو غير موجود حالياً في السيرفر.");
    return;
  }
  if (target.id === actor.id || !actorOutranks(actor, target)) {
    await replyEphemeral(interaction, "لا تملك ترتيباً أعلى من العضو المستهدف أو لا يمكنك استهداف نفسك.");
    return;
  }

  if (subcommand === "warnings") {
    const active = await countActiveWarnings(interaction.guildId, target.id);
    const cases = await listCases(interaction.guildId, { targetId: target.id, type: "warn", limit: 10 });
    const lines = cases.map((item) => `#${item.caseNumber} · ${item.active ? "نشط" : "مغلق"} · ${item.reason || "بدون سبب"}`);
    await replyEphemeral(interaction, {
      embeds: [systemixEmbed({
        title: `تحذيرات ${target.user.username}`,
        tone: active ? "warning" : "success",
        description: `التحذيرات النشطة: **${active}**\n${lines.join("\n").slice(0, 3_500) || "لا توجد قضايا تحذير محفوظة."}`,
      })],
    });
    return;
  }

  const reason = reasonFor(config, interaction.options.getString("reason"));
  if (!reason) {
    await replyEphemeral(interaction, "أدخل سبباً؛ إعداد السيرفر يشترط تسبيب إجراءات الإشراف.");
    return;
  }
  if (subcommand === "clear-warnings") {
    const row = await recordCase(interaction.guild, config, {
      type: "clear_warnings", targetId: target.id, moderatorId: actor.id,
      reason: `${reason} · إغلاق التحذيرات قيد التنفيذ`, source: "manual", active: false,
      metadata: { status: "pending" },
    });
    if (!row) {
      await replyEphemeral(interaction, "تعذر حفظ سجل التدقيق؛ لم أُغلق التحذيرات.");
      return;
    }
    const count = await clearWarnings(interaction.guildId, target.id);
    await updateCaseReason(interaction.guildId, row.caseNumber, `${reason} · أُغلق ${count} تحذيراً نشطاً`);
    await replyEphemeral(interaction, `تم إغلاق ${count} تحذيراً نشطاً للعضو.`);
    return;
  }

  let action: EscalationAction | "untimeout" | "warn" = subcommand as EscalationAction | "untimeout" | "warn";
  let durationSeconds: number | null = null;
  if (subcommand === "timeout") {
    const parsedDuration = (await import("../core/context")).parseDuration(interaction.options.getString("duration", true));
    if (!parsedDuration || parsedDuration > 28 * 24 * 60 * 60) {
      await replyEphemeral(interaction, "المدة غير صحيحة. استخدم مثلاً 15m أو 2h أو 1d وبحد أقصى 28 يوماً.");
      return;
    }
    action = "timeout";
    durationSeconds = parsedDuration;
  }
  if (action === "warn") {
    const warning = await recordCase(interaction.guild, config, {
      type: "warn", targetId: target.id, moderatorId: actor.id, reason, source: "manual", active: true,
    });
    if (!warning) {
      await replyEphemeral(interaction, "تعذر حفظ القضية؛ لم يتم تسجيل التحذير.");
      return;
    }
    if (config.moderation.dmOnAction) await dmAction(target, "تحذير", reason, null);
    const activeWarnings = await countActiveWarnings(interaction.guildId, target.id);
    const escalation = chooseEscalationAction(activeWarnings, config.moderation.escalation);
    if (escalation) {
      const escalationReason = `تصعيد تلقائي بعد ${activeWarnings} تحذيراً نشطاً.`;
      const escalationCase = await recordCase(interaction.guild, config, {
        type: escalation, targetId: target.id, moderatorId: interaction.client.user?.id ?? actor.id,
        reason: `${escalationReason} التنفيذ قيد المعالجة.`, source: "auto", active: false,
        durationSeconds: escalation === "timeout" ? config.moderation.escalation.timeoutMinutes * 60 : null,
        metadata: { escalation: true, warningCount: activeWarnings, status: "pending" },
      });
      if (!escalationCase) {
        await replyEphemeral(interaction, `حُفظ التحذير، لكن تعذر حفظ قضية التصعيد؛ لم أنفذ ${escalation}.`);
        return;
      }
      try {
        const applied = await executeAction(target, escalation, escalationReason,
          escalation === "timeout" ? config.moderation.escalation.timeoutMinutes * 60 : null,
          config.moderation.deleteMessageDaysOnBan);
        await updateCaseReason(interaction.guildId, escalationCase.caseNumber,
          applied ? escalationReason : `${escalationReason} تعذر التنفيذ بسبب الصلاحيات أو ترتيب الرتب.`);
        if (applied && escalation === "timeout") await setCaseActive(interaction.guildId, escalationCase.caseNumber, true);
      } catch (error) {
        logSafe(`Moderation escalation failed in guild ${interaction.guildId}`, error);
        await updateCaseReason(interaction.guildId, escalationCase.caseNumber, `${escalationReason} تعذر التنفيذ.`);
      }
    }
    await replyEphemeral(interaction, `تم تسجيل التحذير في القضية #${warning.caseNumber}. التحذيرات النشطة: ${activeWarnings}.`);
    return;
  }

  const manualAction = action as EscalationAction | "untimeout";
  if (manualAction === "timeout" && !actionAllowedByBot(target, PermissionFlagsBits.ModerateMembers)) {
    await replyEphemeral(interaction, "البوت لا يملك صلاحية Moderate Members أو أن ترتيب رتبته غير كافٍ.");
    return;
  }
  if (manualAction === "kick" && !actionAllowedByBot(target, PermissionFlagsBits.KickMembers)) {
    await replyEphemeral(interaction, "البوت لا يملك صلاحية Kick Members أو أن ترتيب رتبته غير كافٍ.");
    return;
  }
  if (manualAction === "ban" && !actionAllowedByBot(target, PermissionFlagsBits.BanMembers)) {
    await replyEphemeral(interaction, "البوت لا يملك صلاحية Ban Members أو أن ترتيب رتبته غير كافٍ.");
    return;
  }
  const row = await recordCase(interaction.guild, config, {
    type: manualAction,
    targetId: target.id,
    moderatorId: actor.id,
    reason: `${reason} · قيد التنفيذ`,
    durationSeconds,
    source: "manual",
    active: false,
    metadata: { status: "pending" },
  });
  if (!row) {
    await replyEphemeral(interaction, "تعذر حفظ سجل التدقيق؛ لم أنفذ الإجراء.");
    return;
  }
  try {
    const applied = await executeAction(target, manualAction, reason, durationSeconds, config.moderation.deleteMessageDaysOnBan);
    if (!applied) {
      await updateCaseReason(interaction.guildId, row.caseNumber, `${reason} · رفض Discord الإجراء أو لم تتوفر الصلاحية/الترتيب.`);
      await replyEphemeral(interaction, "رفض Discord الإجراء أو لم تتوفر الصلاحية المطلوبة؛ سُجلت محاولة غير ناجحة.");
      return;
    }
    await updateCaseReason(interaction.guildId, row.caseNumber, reason);
    if (manualAction === "timeout") await setCaseActive(interaction.guildId, row.caseNumber, true);
    if (manualAction === "untimeout") await closeActiveTimeoutCases(interaction.guildId, target.id);
    if (config.moderation.dmOnAction) await dmAction(target, manualAction, reason, durationSeconds);
    await replyEphemeral(interaction, `تم تنفيذ ${manualAction} وتسجيل القضية #${row.caseNumber}.`);
  } catch (error) {
    logSafe(`Manual moderation action failed in guild ${interaction.guildId}`, error);
    await updateCaseReason(interaction.guildId, row.caseNumber, `${reason} · تعذر التنفيذ.`);
    await replyEphemeral(interaction, "تعذر تنفيذ الإجراء؛ راجع صلاحيات البوت وترتيب الرتب.");
  }
}

export const moderationModule: SystemixModule = {
  name: "moderation",
  implemented: true,
  commands: [command.toJSON()],
  onCommand,
};
