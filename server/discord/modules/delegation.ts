import { PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type Role } from "discord.js";
import {
  actorOutranks,
  getGuildConfig,
  isSafeGrantRole,
  logSafe,
  recordCase,
  recordEvent,
  replyEphemeral,
  sendSecurityAlert,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { closeActiveTimeoutCases, countCasesSince, setCaseActive, updateCaseReason } from "../store/cases";

const lockedGrants = new Set<string>();

export function canUseDelegationRole(roleId: string, targetRoleIds: readonly string[], protectedRoleIds: readonly string[]): boolean {
  return targetRoleIds.includes(roleId) && !protectedRoleIds.includes(roleId);
}

export function isGrantActor(actorRoleIds: readonly string[], authorizedRoleIds: readonly string[]): boolean {
  return authorizedRoleIds.some((roleId) => actorRoleIds.includes(roleId));
}

function grantRole(guildMember: GuildMember, role: Role, add: boolean, reason: string): Promise<GuildMember> {
  return add ? guildMember.roles.add(role, reason) : guildMember.roles.remove(role, reason);
}

const command = new SlashCommandBuilder()
  .setName("delegate")
  .setDescription("تنفيذ إجراء محدود وفق تفويض مُعد مسبقاً")
  .addSubcommand((sub) => sub.setName("run").setDescription("استخدم تفويضاً محدداً لمرة واحدة")
    .addStringOption((option) => option.setName("grant").setDescription("معرّف التفويض من لوحة التحكم").setRequired(true).setMaxLength(40))
    .addUserOption((option) => option.setName("target").setDescription("العضو المستهدف").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("رتبة التفويض").setRequired(false))
    .addIntegerOption((option) => option.setName("duration_minutes").setDescription("مدة المهلة بالدقائق").setMinValue(1).setMaxValue(10_080))
    .addStringOption((option) => option.setName("nickname").setDescription("الاسم الجديد عند تفويض nickname").setMaxLength(32))
    .addStringOption((option) => option.setName("reason").setDescription("السبب").setMaxLength(300)));

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  if (!config.delegation.enabled) {
    await replyEphemeral(interaction, "جدار التفويض غير مفعّل في إعدادات هذا السيرفر.");
    return;
  }
  const grantId = interaction.options.getString("grant", true);
  const grant = config.delegation.grants.find((item) => item.id === grantId);
  if (!grant) {
    await replyEphemeral(interaction, "معرّف التفويض غير موجود أو تم إيقافه.");
    return;
  }
  const actor = interaction.member as GuildMember;
  if (!isGrantActor([...actor.roles.cache.keys()], grant.actorRoleIds)) {
    await replyEphemeral(interaction, "رتبتك غير مخولة لهذا التفويض.");
    return;
  }
  const user = interaction.options.getUser("target", true);
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target || target.user.bot || target.id === actor.id || !actorOutranks(actor, target)) {
    await replyEphemeral(interaction, "الهدف غير صالح أو لا تملك ترتيباً أعلى منه.");
    return;
  }
  const me = interaction.guild.members.me;
  if (!me || !actorOutranks(me, target)) {
    await replyEphemeral(interaction, "رتبة البوت أدنى من الهدف أو عضوية البوت غير متاحة؛ لم أنفذ الإجراء.");
    return;
  }
  const suppliedReason = interaction.options.getString("reason")?.trim() ?? "";
  if (grant.requireReason && !suppliedReason) {
    await replyEphemeral(interaction, "هذا التفويض يشترط إدخال سبب.");
    return;
  }
  const reason = (suppliedReason || `تفويض: ${grant.label}`).slice(0, 300);
  const lockKey = `${interaction.guildId}|${grant.id}|${actor.id}`;
  if (lockedGrants.has(lockKey)) {
    await replyEphemeral(interaction, "يجري تنفيذ استخدام آخر لهذا التفويض؛ أعد المحاولة بعد لحظات.");
    return;
  }
  lockedGrants.add(lockKey);
  try {
    const uses = await countCasesSince(interaction.guildId, new Date(Date.now() - 3_600_000), {
      source: "delegation", moderatorId: actor.id, grantId: grant.id,
    });
    if (uses >= grant.maxUsesPerHour) {
      await replyEphemeral(interaction, `اكتمل حد التفويض (${grant.maxUsesPerHour} استخدامات خلال الساعة الماضية).`);
      return;
    }
    let role: Role | null = interaction.options.getRole("role");
    const durationMinutes = interaction.options.getInteger("duration_minutes");
    const nickname = interaction.options.getString("nickname")?.trim() ?? "";
    if (grant.action === "add_role" || grant.action === "remove_role") {
      if (!role || !canUseDelegationRole(role.id, grant.targetRoleIds, grant.protectedRoleIds)) {
        await replyEphemeral(interaction, "الرتبة غير موجودة في نطاق التفويض أو أنها محمية.");
        return;
      }
      if (grant.action === "add_role" && !isSafeGrantRole(role)) {
        await replyEphemeral(interaction, "رفضت منح الرتبة لأنها مرتفعة أو مُدارة أو تملك صلاحيات خطرة.");
        return;
      }
      if (grant.action === "remove_role" && (role.managed || role.id === interaction.guildId || !me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0)) {
        await replyEphemeral(interaction, "لا يمكن للبوت إدارة هذه الرتبة وفق ترتيب Discord.");
        return;
      }
    } else if (role) {
      await replyEphemeral(interaction, "هذا التفويض لا يقبل خيار رتبة.");
      return;
    }
    if (grant.action === "timeout" && (!durationMinutes || durationMinutes > grant.maxTimeoutMinutes)) {
      await replyEphemeral(interaction, `أدخل مدة لا تتجاوز ${grant.maxTimeoutMinutes} دقيقة وفق سياسة التفويض.`);
      return;
    }
    if (grant.action !== "timeout" && durationMinutes) {
      await replyEphemeral(interaction, "خيار المدة غير صالح لهذا التفويض.");
      return;
    }
    if (grant.action === "nickname" && (!nickname || !me.permissions.has(PermissionFlagsBits.ManageNicknames))) {
      await replyEphemeral(interaction, "أدخل لقباً صالحاً وتأكد من صلاحية Manage Nicknames.");
      return;
    }
    if (grant.action !== "nickname" && nickname) {
      await replyEphemeral(interaction, "خيار nickname غير صالح لهذا التفويض.");
      return;
    }
    const timeoutAction = grant.action === "timeout" || grant.action === "untimeout";
    if (timeoutAction && !me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await replyEphemeral(interaction, "البوت لا يملك Moderate Members.");
      return;
    }
    if ((grant.action === "add_role" || grant.action === "remove_role") && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await replyEphemeral(interaction, "البوت لا يملك Manage Roles.");
      return;
    }

    const caseRow = await recordCase(interaction.guild, config, {
      type: "delegation", targetId: target.id, moderatorId: actor.id, reason,
      source: "delegation", active: false,
      durationSeconds: grant.action === "timeout" && durationMinutes ? durationMinutes * 60 : null,
      metadata: { grantId: grant.id, action: grant.action, status: "pending" },
    });
    if (!caseRow) {
      await replyEphemeral(interaction, "تعذر حفظ سجل التدقيق؛ رفضت تنفيذ التفويض.");
      return;
    }
    let result = "completed";
    try {
      switch (grant.action) {
        case "add_role":
          await grantRole(target, role!, true, `Security Systemix delegation ${grant.id}: ${reason}`);
          break;
        case "remove_role":
          await grantRole(target, role!, false, `Security Systemix delegation ${grant.id}: ${reason}`);
          break;
        case "timeout":
          await target.timeout(durationMinutes! * 60_000, `Security Systemix delegation ${grant.id}: ${reason}`);
          break;
        case "untimeout":
          await target.timeout(null, `Security Systemix delegation ${grant.id}: ${reason}`);
          break;
        case "nickname":
          await target.setNickname(nickname, `Security Systemix delegation ${grant.id}: ${reason}`);
          break;
      }
    } catch (error) {
      result = "discord_action_failed";
      logSafe(`Delegated action failed for guild ${interaction.guildId}`, error);
    }
    await updateCaseReason(interaction.guildId, caseRow.caseNumber, `${reason} · ${result}`);
    if (result === "completed" && grant.action === "timeout") await setCaseActive(interaction.guildId, caseRow.caseNumber, true);
    if (result === "completed" && grant.action === "untimeout") await closeActiveTimeoutCases(interaction.guildId, target.id);
    await recordEvent({
      guildId: interaction.guildId, eventType: `delegation:${grant.action}`, actorId: actor.id,
      targetId: target.id, severity: result === "completed" ? "low" : "medium",
      details: { grantId: grant.id, caseNumber: caseRow.caseNumber, result },
    });
    await sendSecurityAlert(interaction.guild, config, config.delegation.logChannelId, {
      embeds: [systemixEmbed({
        title: result === "completed" ? "اكتمل إجراء التفويض" : "تعذر إجراء التفويض",
        tone: result === "completed" ? "success" : "warning",
        fields: [
          { name: "التفويض", value: `${grant.label} · \`${grant.id}\``, inline: true },
          { name: "الإجراء", value: grant.action, inline: true },
          { name: "المنفذ / المستهدف", value: `\`${actor.id}\` → \`${target.id}\`` },
          { name: "رقم القضية", value: `#${caseRow.caseNumber}`, inline: true },
          { name: "النتيجة", value: result, inline: true },
        ],
        config,
      })],
      allowedMentions: { parse: [] },
    });
    await replyEphemeral(interaction, result === "completed"
      ? `اكتمل التفويض **${grant.label}** وسُجلت القضية #${caseRow.caseNumber}.`
      : `رفض Discord الإجراء؛ سُجلت المحاولة في القضية #${caseRow.caseNumber}.`);
  } finally {
    lockedGrants.delete(lockKey);
  }
}

export const delegationModule: SystemixModule = {
  name: "delegation",
  implemented: true,
  commands: [command.toJSON()],
  onCommand,
};
