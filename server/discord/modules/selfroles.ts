import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type GuildMember,
  type Role,
} from "discord.js";
import { getGuildConfig, isSafeGrantRole, replyEphemeral, sendToChannel, systemixEmbed } from "../core/context";
import type { SelfRolePanel } from "../config";
import type { SystemixModule } from "../core/types";
import { customId, type ComponentInteraction } from "../core/types";

const PREFIX = "selfroles";
const MAX_PANEL_ID = 24;

/** Panel IDs are bounded slugs in config; reject delimiters to prevent routing ambiguity. */
export function isValidSelfRolePanelId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PANEL_ID && /^[a-z0-9_-]+$/.test(value);
}

/** A selectable role must be a member of this exact panel and safe at runtime. */
export function isAllowedSelfRole(panel: Pick<SelfRolePanel, "roles"> | undefined, roleId: string): boolean {
  return Boolean(panel?.roles.some((entry) => entry.roleId === roleId));
}

export function chunkSelfRoleEntries<T>(entries: readonly T[], chunkSize = 5): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 5) throw new RangeError("invalid_chunk_size");
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += chunkSize) chunks.push(entries.slice(index, index + chunkSize));
  return chunks;
}

/** Accept only sx:selfroles:<bounded-panel-slug>:<known-action> component IDs. */
export function parseSelfRoleCustomId(value: string): { panelId: string; action: "toggle" | "select" } | null {
  if (value.length > 100) return null;
  const match = /^sx:selfroles:([a-z0-9_-]{1,24}):(toggle|select)$/.exec(value);
  return match ? { panelId: match[1], action: match[2] as "toggle" | "select" } : null;
}

const command = new SlashCommandBuilder()
  .setName("selfroles")
  .setDescription("نشر لوحة الرتب الذاتية المعرفة في الإعدادات")
  .addStringOption((option) => option.setName("panel").setDescription("معرّف اللوحة المُعدة").setRequired(true).setMaxLength(MAX_PANEL_ID));

function rows(panel: SelfRolePanel) {
  if (panel.mode === "toggle") {
    return chunkSelfRoleEntries(panel.roles).map((entries) => new ActionRowBuilder<ButtonBuilder>().addComponents(
      entries.map((entry) => new ButtonBuilder().setCustomId(customId(PREFIX, panel.id, "toggle", entry.roleId)).setLabel(entry.label)
        .setStyle(ButtonStyle.Secondary).setEmoji(entry.emoji || "🏷️").setDisabled(false)),
    ));
  }
  const menu = new StringSelectMenuBuilder().setCustomId(customId(PREFIX, panel.id, "select"))
    .setPlaceholder("اختر رتبة واحدة").setMinValues(1).setMaxValues(1)
    .addOptions(panel.roles.map((entry) => ({ label: entry.label, value: entry.roleId, ...(entry.emoji ? { emoji: entry.emoji } : {}) })));
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  if (!(interaction.member as GuildMember).permissions.has(PermissionFlagsBits.ManageGuild)) {
    await replyEphemeral(interaction, "يتطلب نشر اللوحة صلاحية Manage Server.");
    return;
  }
  if (!config.selfRoles.enabled) {
    await replyEphemeral(interaction, "وحدة الرتب الذاتية غير مفعّلة.");
    return;
  }
  const panelId = interaction.options.getString("panel", true);
  const panel = config.selfRoles.panels.find((entry) => entry.id === panelId && isValidSelfRolePanelId(entry.id));
  if (!panel || !panel.channelId || !panel.roles.length) {
    await replyEphemeral(interaction, "اللوحة غير موجودة أو لا تحتوي قناة وأدواراً معدة.");
    return;
  }
  const channel = interaction.guild.channels.cache.get(panel.channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    await replyEphemeral(interaction, "قناة اللوحة غير متاحة في هذا السيرفر.");
    return;
  }
  const validRoles = panel.roles.filter((entry) => {
    const role = interaction.guild.roles.cache.get(entry.roleId);
    return Boolean(role && isSafeGrantRole(role));
  });
  if (validRoles.length !== panel.roles.length) {
    await replyEphemeral(interaction, "تحتوي اللوحة رتبة غير آمنة/مُدارة/أعلى من رتبة البوت؛ أصلح إعداداتها قبل النشر.");
    return;
  }
  const posted = await sendToChannel(interaction.guild, panel.channelId, {
    embeds: [systemixEmbed({ title: panel.title, description: panel.description, config })],
    components: rows(panel), allowedMentions: { parse: [] },
  });
  await replyEphemeral(interaction, posted ? `نُشرت لوحة «${panel.title}» في القناة المحددة.` : "تعذر النشر؛ تحقق من صلاحيات القناة.");
}

function resolveMember(interaction: ComponentInteraction): GuildMember | null {
  const member = interaction.member;
  return member instanceof Object && "roles" in member ? member as GuildMember : null;
}

async function onComponent(interaction: ComponentInteraction): Promise<void> {
  const parsed = parseSelfRoleCustomId(interaction.customId);
  if (!parsed) return;
  if (interaction.user.bot) {
    await replyEphemeral(interaction, "الحسابات الآلية لا تستخدم لوحة الرتب.");
    return;
  }
  const config = await getGuildConfig(interaction.guildId);
  const panel = config.selfRoles.panels.find((candidate) => candidate.id === parsed.panelId);
  const expectedAction = panel?.mode === "toggle" ? "toggle" : "select";
  if (!config.selfRoles.enabled || !panel || !panel.channelId || interaction.channelId !== panel.channelId || parsed.action !== expectedAction) {
    await replyEphemeral(interaction, "هذه اللوحة غير نشطة أو ليست في قناتها المحددة.");
    return;
  }
  const member = resolveMember(interaction);
  const me = interaction.guild.members.me;
  if (!member || !me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await replyEphemeral(interaction, "تعذر جلب العضوية أو أن البوت لا يملك Manage Roles.");
    return;
  }
  const roleIds = interaction.isButton() ? [] : interaction.values;
  const selectedId = interaction.isButton() ? parsedRoleFromButton(interaction.customId, panel) : roleIds[0];
  if (!selectedId || roleIds.length > 1 || !isAllowedSelfRole(panel, selectedId)) {
    await replyEphemeral(interaction, "الاختيار غير موجود ضمن هذه اللوحة.");
    return;
  }
  const selected = interaction.guild.roles.cache.get(selectedId);
  if (!selected || !isSafeGrantRole(selected)) {
    await replyEphemeral(interaction, "الرتبة المختارة لم تعد آمنة أو قابلة للإدارة.");
    return;
  }
  const managedPanelRoles: Role[] = [];
  for (const entry of panel.roles) {
    const role = interaction.guild.roles.cache.get(entry.roleId);
    if (!role || !isSafeGrantRole(role)) {
      await replyEphemeral(interaction, "توقفت اللوحة لأن إحدى رتبها لم تعد آمنة.");
      return;
    }
    managedPanelRoles.push(role);
  }
  try {
    if (panel.mode === "toggle") {
      if (member.roles.cache.has(selected.id)) await member.roles.remove(selected, "Security Systemix self-role toggle");
      else await member.roles.add(selected, "Security Systemix self-role toggle");
      await replyEphemeral(interaction, "تم تحديث الرتبة.");
    } else {
      const removals = managedPanelRoles.filter((role) => role.id !== selected.id && member.roles.cache.has(role.id));
      // Only other roles listed in this panel are candidates. Every removal independently passes safety/hierarchy checks.
      for (const role of removals) {
        if (!isSafeGrantRole(role)) throw new Error("role_not_safe");
      }
      if (removals.length) await member.roles.remove(removals, "Security Systemix self-role single selection");
      if (!member.roles.cache.has(selected.id)) await member.roles.add(selected, "Security Systemix self-role single selection");
      await replyEphemeral(interaction, "تم تحديث اختيار الرتبة.");
    }
  } catch {
    await replyEphemeral(interaction, "رفض Discord التغيير؛ تحقق من صلاحية Manage Roles وترتيب الرتب.");
  }
}

function parsedRoleFromButton(id: string, panel: SelfRolePanel): string | null {
  const match = /^sx:selfroles:([a-z0-9_-]{1,24}):toggle:(\d{17,20})$/.exec(id);
  return match?.[1] === panel.id ? match[2] : null;
}

export const selfRolesModule: SystemixModule = {
  name: "selfRoles",
  implemented: true,
  commands: [command.toJSON()],
  componentPrefix: PREFIX,
  onCommand,
  onComponent,
};
