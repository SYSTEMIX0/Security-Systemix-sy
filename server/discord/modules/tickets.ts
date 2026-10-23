import { ActionRowBuilder, ChannelType, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type GuildMember } from "discord.js";
import type { SystemixModule } from "../core/types";
import { customId } from "../core/types";
import { getGuildConfig, replyEphemeral, logSafe, isStaffMember } from "../core/context";
import { createTicket, listOpenTickets, setTicketChannel, getTicketByChannel, closeTicket, claimTicket } from "../store/tickets";

export function cleanTicketChannelName(name: string): string {
  const value = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return value || "ticket";
}

export function canManageTicket(actorId: string, openerId: string, staff: boolean): boolean {
  return actorId === openerId || staff;
}

const command = new SlashCommandBuilder().setName("ticket").setDescription("إدارة التذاكر")
  .addSubcommand((sub) => sub.setName("panel").setDescription("نشر لوحة فتح التذاكر"));

async function handleCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]) {
  const cfg = await getGuildConfig(interaction.guildId).then((value) => value.tickets);
  if (!cfg.enabled) return replyEphemeral(interaction, "نظام التذاكر غير مفعّل.");
  if (!isStaffMember(interaction.member as GuildMember, await getGuildConfig(interaction.guildId))) return replyEphemeral(interaction, "هذا الأمر مخصص لفريق الدعم.");
  if (interaction.options.getSubcommand() !== "panel") return;
  const channel = cfg.panelChannelId ? interaction.guild.channels.cache.get(cfg.panelChannelId) : null;
  if (!channel?.isTextBased() || !("send" in channel)) return replyEphemeral(interaction, "قناة اللوحة غير متاحة.");
  const menu = new StringSelectMenuBuilder().setCustomId(customId("tickets", "open")).setPlaceholder("اختر موضوع التذكرة").addOptions(
    cfg.topics.map((topic) => ({ label: topic.label, value: topic.id, description: topic.description || undefined, emoji: topic.emoji || undefined })));
  await channel.send({ embeds: [new EmbedBuilder().setTitle(cfg.panelTitle).setDescription(cfg.panelDescription)], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], allowedMentions: { parse: [] } });
  await replyEphemeral(interaction, "تم نشر اللوحة.");
}

async function onComponent(interaction: Parameters<NonNullable<SystemixModule["onComponent"]>>[0]) {
  const [action, arg] = interaction.customId.split(":").slice(2);
  const guild = interaction.guild;
  if (!guild) return replyEphemeral(interaction, "تعذر تحديد السيرفر.");
  const config = await getGuildConfig(guild.id);
  const cfg = config.tickets;
  if (!cfg.enabled) return replyEphemeral(interaction, "نظام التذاكر غير مفعّل.");
  const member = interaction.member as GuildMember;
  if (action === "open" && interaction.isStringSelectMenu()) {
    const topic = cfg.topics.find((item) => item.id === interaction.values[0]);
    if (!topic || !cfg.categoryId) return replyEphemeral(interaction, "موضوع أو تصنيف التذاكر غير صالح.");
    const category = guild.channels.cache.get(cfg.categoryId);
    const me = guild.members.me;
    if (!category || category.type !== ChannelType.GuildCategory || !me?.permissions.has(PermissionFlagsBits.ManageChannels)) return replyEphemeral(interaction, "إعدادات التذاكر أو صلاحية Manage Channels غير متاحة.");
    const roles = cfg.staffRoleIds.map((id) => guild.roles.cache.get(id));
    if (roles.some((role) => !role)) return replyEphemeral(interaction, "يوجد دور دعم غير موجود.");
    if (roles.some((role) => role!.managed || me.roles.highest.comparePositionTo(role!) <= 0)) return replyEphemeral(interaction, "ترتيب أدوار البوت لا يسمح بتطبيق صلاحيات الدعم بأمان.");
    try {
      const open = await listOpenTickets(guild.id, member.id);
      if (open.length >= cfg.maxOpenPerUser) return replyEphemeral(interaction, "بلغت الحد الأقصى للتذاكر المفتوحة.");
      const ticket = await createTicket({ guildId: guild.id, openerId: member.id, topic: topic.id });
      let channel;
      try {
        channel = await guild.channels.create({ name: cleanTicketChannelName(`ticket-${ticket.ticketNumber}-${member.user.username}`), type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ...roles.map((role) => ({ id: role!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ] });
        await setTicketChannel(guild.id, ticket.id, channel.id);
      } catch (error) {
        if (channel) await channel.delete().catch(() => undefined);
        await closeTicket(guild.id, ticket.id, member.id).catch(() => undefined);
        throw error;
      }
      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId("tickets", "claim", ticket.id)).setLabel("استلام").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(customId("tickets", "close", ticket.id)).setLabel("إغلاق").setStyle(ButtonStyle.Danger));
      const text = cfg.openMessage.replace(/\{user\}/g, `<@${member.id}>`).slice(0, 1000);
      await channel.send({ content: text, components: [controls], allowedMentions: { users: [member.id], roles: [], parse: [] } });
      await replyEphemeral(interaction, `تم فتح تذكرتك: <#${channel.id}>`);
    } catch (error) { logSafe(`Ticket creation failed in guild ${guild.id}`, error); await replyEphemeral(interaction, "تعذر إنشاء التذكرة حالياً."); }
    return;
  }
  if ((action === "close" || action === "claim") && arg && /^\d+$/.test(arg)) {
    const ticket = await getTicketByChannel(guild.id, interaction.channelId);
    if (!ticket || ticket.id !== Number(arg) || ticket.status === "closed") return replyEphemeral(interaction, "التذكرة غير متاحة.");
    const staff = isStaffMember(member, config) || cfg.staffRoleIds.some((id) => member.roles.cache.has(id));
    if (action === "close") {
      if (!canManageTicket(member.id, ticket.openerId, staff)) return replyEphemeral(interaction, "لا يمكنك إغلاق تذكرة شخص آخر.");
      await closeTicket(guild.id, ticket.id, member.id);
      await replyEphemeral(interaction, "تم إغلاق التذكرة. لن يتم حفظ أي نصوص رسائل.");
      setTimeout(() => interaction.channel?.delete().catch(() => undefined), 1500).unref?.();
    } else {
      if (!staff) return replyEphemeral(interaction, "استلام التذكرة متاح لفريق الدعم فقط.");
      await claimTicket(guild.id, ticket.id, member.id);
      await replyEphemeral(interaction, "تم استلام التذكرة.");
    }
  }
}

export const ticketsModule: SystemixModule = { name: "tickets", implemented: true, commands: [command.toJSON()], onCommand: handleCommand, componentPrefix: "tickets", onComponent };
