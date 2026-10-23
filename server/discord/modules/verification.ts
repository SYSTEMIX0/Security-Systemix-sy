import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  getGuildConfig,
  isSafeGrantRole,
  isStaffMember,
  logSafe,
  recordEvent,
  replyEphemeral,
  sendSecurityAlert,
  sendToChannel,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { customId, type ComponentInteraction } from "../core/types";

export function canVerifyMember(input: {
  enabled: boolean; mode: string; channelMatches: boolean; ageHours: number; minAgeHours: number;
}): { allowed: boolean; reason: string } {
  if (!input.enabled) return { allowed: false, reason: "disabled" };
  if (input.mode !== "button") return { allowed: false, reason: "unsupported_mode" };
  if (!input.channelMatches) return { allowed: false, reason: "wrong_channel" };
  if (input.ageHours < input.minAgeHours) return { allowed: false, reason: "account_too_new" };
  return { allowed: true, reason: "ok" };
}

const command = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("نشر لوحة التحقق المحددة في إعدادات Security Systemix")
  .addSubcommand((sub) => sub.setName("panel").setDescription("نشر زر التحقق في القناة المحددة"));

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  if (!isStaffMember(interaction.member as GuildMember, config)) {
    await replyEphemeral(interaction, "نشر لوحة التحقق متاح لمالك السيرفر وفريق الإشراف فقط.");
    return;
  }
  if (!config.verification.enabled || !config.verification.channelId) {
    await replyEphemeral(interaction, "فعّل وحدة التحقق وحدد قناة النشر من لوحة Security Systemix أولاً.");
    return;
  }
  if (config.verification.mode !== "button") {
    await replyEphemeral(interaction, "وضع CAPTCHA لم يُفعّل؛ لا يوجد مزود CAPTCHA خارجي موصول. اختر وضع الزر أو انتظر إعداد تكامل مستقل.");
    return;
  }
  const role = config.verification.verifiedRoleId
    ? interaction.guild.roles.cache.get(config.verification.verifiedRoleId)
    : null;
  if (!role || !isSafeGrantRole(role)) {
    await replyEphemeral(interaction, "رتبة Verified غير متاحة أو غير آمنة أو أعلى من رتبة البوت؛ لم أنشر لوحة التحقق.");
    return;
  }
  if (config.verification.removeRoleId) {
    const roleToRemove = interaction.guild.roles.cache.get(config.verification.removeRoleId);
    if (!roleToRemove || !isSafeGrantRole(roleToRemove)) {
      await replyEphemeral(interaction, "رتبة ما قبل التحقق غير صالحة أو غير آمنة؛ أصلح الإعدادات قبل النشر.");
      return;
    }
  }
  const button = new ButtonBuilder().setCustomId(customId("verification", "complete"))
    .setLabel("تحققت من العضوية").setStyle(ButtonStyle.Success);
  const payload = {
    embeds: [systemixEmbed({
      title: config.verification.panelTitle,
      description: config.verification.panelDescription,
      tone: "brand",
      config,
    })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    allowedMentions: { parse: [] as never[] },
  };
  const posted = await sendToChannel(interaction.guild, config.verification.channelId, payload);
  if (!posted) {
    await replyEphemeral(interaction, "تعذر النشر؛ تحقق من وجود القناة وصلاحيات View Channel وSend Messages وEmbed Links.");
    return;
  }
  await replyEphemeral(interaction, `نُشرت لوحة التحقق في القناة المحددة (رسالة ${posted.id}).`);
}

async function onComponent(interaction: ComponentInteraction): Promise<void> {
  if (!interaction.isButton()) return;
  if (interaction.customId !== customId("verification", "complete")) return;
  if (interaction.user.bot) {
    await replyEphemeral(interaction, "الحسابات الآلية لا تستخدم بوابة التحقق.");
    return;
  }
  const config = await getGuildConfig(interaction.guildId);
  const channelMatches = Boolean(config.verification.channelId && interaction.channelId === config.verification.channelId);
  const member = interaction.member;
  const ageHours = Math.max(0, (Date.now() - interaction.user.createdTimestamp) / 3_600_000);
  const eligibility = canVerifyMember({
    enabled: config.verification.enabled,
    mode: config.verification.mode,
    channelMatches,
    ageHours,
    minAgeHours: config.verification.minAccountAgeHours,
  });
  if (!eligibility.allowed) {
    if (eligibility.reason === "account_too_new") {
      await recordEvent({ guildId: interaction.guildId, eventType: "verification:age_gate", actorId: interaction.user.id, targetId: interaction.user.id, severity: "medium", details: { ageHours: Math.floor(ageHours) } });
      await sendSecurityAlert(interaction.guild, config, config.verification.logChannelId, {
        embeds: [systemixEmbed({ title: "رُفض طلب تحقق بسبب حد عمر الحساب", tone: "warning", fields: [
          { name: "معرّف العضو", value: `\`${interaction.user.id}\`` },
          { name: "العمر بالساعات", value: String(Math.floor(ageHours)), inline: true },
        ], config })],
        allowedMentions: { parse: [] },
      });
      await replyEphemeral(interaction, `عمر الحساب أقل من الحد المطلوب (${config.verification.minAccountAgeHours} ساعة). تواصل مع إدارة السيرفر للمراجعة.`);
      return;
    }
    await replyEphemeral(interaction, eligibility.reason === "unsupported_mode"
      ? "طريقة التحقق الحالية غير مدعومة بعد؛ لا يوجد CAPTCHA خارجي موصول.": "هذا الزر غير نشط أو ليس في قناة التحقق المحددة.");
    return;
  }
  if (!(member instanceof Object) || !("roles" in member)) {
    await replyEphemeral(interaction, "تعذر جلب عضويتك داخل السيرفر؛ حاول مجدداً.");
    return;
  }
  const guildMember = member as GuildMember;
  const role = config.verification.verifiedRoleId
    ? interaction.guild.roles.cache.get(config.verification.verifiedRoleId)
    : null;
  if (!role || !isSafeGrantRole(role)) {
    await recordEvent({ guildId: interaction.guildId, eventType: "verification:role_unavailable", actorId: interaction.user.id, targetId: interaction.user.id, severity: "high", details: { roleId: config.verification.verifiedRoleId } });
    await sendSecurityAlert(interaction.guild, config, config.verification.logChannelId, {
      embeds: [systemixEmbed({ title: "توقفت بوابة التحقق لحماية الرتب", tone: "danger", description: `تعذر إسناد رتبة Verified بأمان. العضو: \`${interaction.user.id}\`.`, config })],
      allowedMentions: { parse: [] },
    });
    await replyEphemeral(interaction, "تعذر التحقق لأن رتبة Verified لم تعد آمنة أو قابلة للإسناد. أُبلغت الإدارة.");
    return;
  }
  if (guildMember.roles.cache.has(role.id)) {
    await replyEphemeral(interaction, "أنت متحقق بالفعل.");
    return;
  }
  const auditSaved = await recordEvent({ guildId: interaction.guildId, eventType: "verification:attempt", actorId: interaction.user.id, targetId: interaction.user.id, severity: "low", details: { roleId: role.id } });
  if (!auditSaved) {
    await replyEphemeral(interaction, "تعذر حفظ سجل التحقق؛ لم أغيّر رتبتك. أعد المحاولة لاحقاً.");
    return;
  }
  try {
    await guildMember.roles.add(role, "Security Systemix verification button");
    const removeRole = config.verification.removeRoleId
      ? interaction.guild.roles.cache.get(config.verification.removeRoleId)
      : null;
    if (removeRole && guildMember.roles.cache.has(removeRole.id) && isSafeGrantRole(removeRole)) {
      await guildMember.roles.remove(removeRole, "Security Systemix verification completed").catch((error) => logSafe("Unverified role removal failed", error));
    }
    await recordEvent({ guildId: interaction.guildId, eventType: "verification:completed", actorId: interaction.user.id, targetId: interaction.user.id, severity: "low", details: { roleId: role.id } });
    await sendSecurityAlert(interaction.guild, config, config.verification.logChannelId, {
      embeds: [systemixEmbed({ title: "اكتمل تحقق عضو", tone: "success", fields: [
        { name: "معرّف العضو", value: `\`${interaction.user.id}\`` },
        { name: "الرتبة", value: `\`${role.id}\`` },
      ], config })],
      allowedMentions: { parse: [] },
    });
    await replyEphemeral(interaction, "اكتمل التحقق وأُسندت الرتبة المسموحة.");
  } catch (error) {
    logSafe(`Verification role assignment failed in guild ${interaction.guildId}`, error);
    await recordEvent({ guildId: interaction.guildId, eventType: "verification:assignment_failed", actorId: interaction.user.id, targetId: interaction.user.id, severity: "high", details: { roleId: role.id } });
    await sendSecurityAlert(interaction.guild, config, config.verification.logChannelId, {
      embeds: [systemixEmbed({ title: "فشل إسناد رتبة التحقق", tone: "danger", fields: [
        { name: "معرّف العضو", value: `\`${interaction.user.id}\`` },
        { name: "الرتبة", value: `\`${role.id}\`` },
      ], config })],
      allowedMentions: { parse: [] },
    });
    await replyEphemeral(interaction, "رفض Discord تحديث رتبتك؛ تحقق من ترتيب الرتب وصلاحية Manage Roles.");
  }
}

export const verificationModule: SystemixModule = {
  name: "verification",
  implemented: true,
  componentPrefix: "verification",
  commands: [command.toJSON()],
  onCommand,
  onComponent,
};
