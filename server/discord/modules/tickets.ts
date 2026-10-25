import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
  type Message,
  type TextChannel,
} from "discord.js";
import type { ComponentInteraction, SystemixModule } from "../core/types";
import { defaultGuildSecurityConfig, mergeGuildSecurityConfig } from "../config";
import { customId } from "../core/types";
import { getGuildConfig, isStaffMember, logSafe } from "../core/context";
import { recordSecurityEvent, upsertGuildSecuritySettings } from "../../db";
import {
  TicketLimitReachedError,
  beginTicketClose,
  cancelTicketReservation,
  claimTicket,
  createTicket,
  finishTicketClose,
  getTicketByChannel,
  restoreTicketAfterCloseFailure,
  setTicketChannel,
} from "../store/tickets";

export function cleanTicketChannelName(name: string): string {
  const value = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return value || "ticket";
}

export function ticketChannelPrefix(topicId: string): string {
  const names: Record<string, string> = {
    "open-ticket": "open-ticket",
    "middleman-ticket": "middleman-ticket",
    "levelup-ticket": "levelup-ticket",
  };
  return names[topicId] ?? cleanTicketChannelName(`ticket-${topicId}`);
}

/** The public, read-only channels that carry the three separate ticket panels. */
export const TICKET_PANEL_CHANNELS: Record<string, string> = {
  "open-ticket": "🎫・open-ticket",
  "middleman-ticket": "🤝・middleman-ticket",
  "levelup-ticket": "📈・levelup-ticket",
};

const PANEL_CATEGORY_NAME = "🎫・ticket-panels";
const LEGACY_PANEL_CATEGORY_NAME = "🎫・systemix-tickets";
const ACTIVE_TICKETS_CATEGORY_NAME = "🔒・active-tickets";

export function ticketPanelChannelName(topicId: string): string {
  return TICKET_PANEL_CHANNELS[topicId] ?? `🎫・${ticketChannelPrefix(topicId)}`;
}

export function canManageTicket(actorId: string, openerId: string, staff: boolean): boolean {
  return actorId === openerId || staff;
}

type TicketInteraction = Parameters<NonNullable<SystemixModule["onCommand"]>>[0] | ComponentInteraction;

async function deferTicketReply(interaction: TicketInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

async function respond(interaction: TicketInteraction, content: string): Promise<void> {
  try {
    if (interaction.deferred) {
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } else if (interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    logSafe("Ticket interaction response failed", error);
  }
}

function supportRoles(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"], config: Awaited<ReturnType<typeof getGuildConfig>>) {
  const roleIds = [...new Set([...config.tickets.staffRoleIds, ...config.general.staffRoleIds])]
    .filter((id) => id !== guild.id);
  return roleIds.map((id) => guild.roles.cache.get(id)).filter((role): role is NonNullable<typeof role> => Boolean(role));
}

const command = new SlashCommandBuilder().setName("ticket").setDescription("إدارة التذاكر")
  .addSubcommand((sub) => sub.setName("panel").setDescription("نشر أو تحديث لوحة فتح التذاكر"))
  .addSubcommand((sub) => sub.setName("setup").setDescription("إعداد نظام التذاكر وإنشاء لوحته تلقائياً")
    .addRoleOption((option) => option.setName("support-role").setDescription("رتبة فريق الدعم التي ترى التذاكر").setRequired(true)));

function ticketPanel(cfg: Awaited<ReturnType<typeof getGuildConfig>>["tickets"], topic: Awaited<ReturnType<typeof getGuildConfig>>["tickets"]["topics"][number]) {
  const button = new ButtonBuilder()
    .setCustomId(customId("tickets", "open", topic.id))
    .setLabel(`فتح ${topic.label}`.slice(0, 80))
    .setStyle(ButtonStyle.Primary);
  if (topic.emoji) button.setEmoji(topic.emoji);
  return {
    embeds: [new EmbedBuilder()
      .setTitle(`${topic.emoji ? `${topic.emoji} ` : ""}${topic.label}`)
      .setDescription([cfg.panelDescription, topic.description].filter(Boolean).join("\n\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    allowedMentions: { parse: [] as [] },
  };
}

function findPanelCategory(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"]) {
  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildCategory) return false;
    const name = channel.name.toLowerCase();
    return channel.name === PANEL_CATEGORY_NAME || channel.name === LEGACY_PANEL_CATEGORY_NAME || name === "tickets";
  }) ?? null;
}

function findTextChannel(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"], categoryId: string, name: string): TextChannel | null {
  const channel = guild.channels.cache.find((candidate) => candidate.parentId === categoryId
    && candidate.type === ChannelType.GuildText
    && candidate.name === name) ?? null;
  return channel as TextChannel | null;
}

function containsTicketTrigger(message: Pick<Message<true>, "components">): boolean {
  return message.components.some((row) => "components" in row
    && Array.isArray(row.components)
    && row.components.some((component) => "customId" in component
      && typeof component.customId === "string"
      && component.customId.startsWith(customId("tickets", "open"))));
}

async function publishTopicPanel(
  channel: TextChannel,
  payload: ReturnType<typeof ticketPanel>,
  botUserId: string,
): Promise<void> {
  // Missing Read Message History must not prevent a permitted bot from sending a fresh panel.
  const existing = await channel.messages.fetch({ limit: 50 })
    .then((messages) => messages.find((message) => message.author.id === botUserId && containsTicketTrigger(message)))
    .catch(() => undefined);
  if (existing) await existing.edit(payload);
  else await channel.send(payload);
}

async function publishTicketPanels(
  guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"],
  cfg: Awaited<ReturnType<typeof getGuildConfig>>["tickets"],
  panelCategoryId: string,
  botUserId: string,
): Promise<void> {
  for (const topic of cfg.topics) {
    const channel = findTextChannel(guild, panelCategoryId, ticketPanelChannelName(topic.id));
    if (!channel) throw new Error(`ticket_panel_channel_missing:${topic.id}`);
    await publishTopicPanel(channel, ticketPanel(cfg, topic), botUserId);
  }
}

async function handleCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]) {
  await deferTicketReply(interaction);
  const config = await getGuildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "setup") return setupTicketSystem(interaction, config);
  const cfg = config.tickets;
  if (!cfg.enabled) return respond(interaction, "نظام التذاكر غير مفعّل.");
  if (!isStaffMember(interaction.member as GuildMember, config)) return respond(interaction, "هذا الأمر مخصص لفريق الدعم.");
  if (subcommand !== "panel") return respond(interaction, "الأمر غير متاح.");
  const category = findPanelCategory(interaction.guild);
  if (!category) return respond(interaction, "لا توجد قنوات لوحات التذاكر بعد. استخدم /ticket setup أولاً.");
  if (cfg.topics.length === 0) return respond(interaction, "أضف نوع تذكرة واحداً على الأقل قبل نشر اللوحة.");

  try {
    await publishTicketPanels(interaction.guild, cfg, category.id, interaction.client.user.id);
    return respond(interaction, "تم تحديث لوحات فتح التذكرة والوسيط ورفع المستوى.");
  } catch (error) {
    logSafe(`Ticket panel publish failed in guild ${interaction.guildId}`, error);
    return respond(interaction, "تعذر نشر إحدى لوحات التذاكر. تأكد أن البوت يملك View Channel وSend Messages ثم أعد /ticket setup.");
  }
}

async function setupTicketSystem(
  interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0],
  config: Awaited<ReturnType<typeof getGuildConfig>>,
): Promise<void> {
  const member = interaction.member as GuildMember;
  if (member.id !== interaction.guild.ownerId && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return respond(interaction, "هذا الأمر مخصص لمالك السيرفر أو من يملك صلاحية Manage Server.");
  }
  const supportRole = interaction.options.getRole("support-role", true);
  if (supportRole.id === interaction.guild.id || supportRole.managed) {
    return respond(interaction, "اختر رتبة دعم حقيقية؛ لا يمكن استخدام @everyone أو رتبة يملكها تطبيق آخر.");
  }
  try {
    // The audit precondition intentionally happens before any channel is created.
    await recordSecurityEvent({
      guildId: interaction.guildId,
      eventType: "ticket:setup_precondition",
      actorId: member.id,
      severity: "medium",
      details: { supportRoleId: supportRole.id },
    });
  } catch (error) {
    logSafe(`Ticket setup audit precondition failed in guild ${interaction.guildId}`, error);
    return respond(interaction, "تعذر توثيق عملية الإعداد في سجل التدقيق؛ لم يتم إنشاء أي قناة.");
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.SendMessages)) {
    return respond(interaction, "لا يملك البوت حالياً Manage Channels وSend Messages. أعطه هاتين الصلاحيتين ثم أعد /ticket setup.");
  }

  const createdCategories: Array<{ delete: (reason?: string) => Promise<unknown> }> = [];
  const createdPanels: TextChannel[] = [];
  let panelCategory = findPanelCategory(interaction.guild);
  let activeCategory = interaction.guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === ACTIVE_TICKETS_CATEGORY_NAME) ?? null;
  try {
    if (!panelCategory) {
      panelCategory = await interaction.guild.channels.create({ name: PANEL_CATEGORY_NAME, type: ChannelType.GuildCategory, reason: "Security Systemix ticket panel setup" });
      createdCategories.push(panelCategory);
    }
    if (!activeCategory) {
      activeCategory = await interaction.guild.channels.create({
        name: ACTIVE_TICKETS_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          { id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
        reason: "Security Systemix private ticket category",
      });
      createdCategories.push(activeCategory);
    }

    const panels: TextChannel[] = [];
    const setupTopics = defaultGuildSecurityConfig.tickets.topics;
    for (const topic of setupTopics) {
      let panel = findTextChannel(interaction.guild, panelCategory.id, ticketPanelChannelName(topic.id));
      if (!panel) {
        panel = await interaction.guild.channels.create({
          name: ticketPanelChannelName(topic.id),
          type: ChannelType.GuildText,
          parent: panelCategory.id,
          permissionOverwrites: [
            { id: interaction.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ],
          reason: "Security Systemix ticket panel",
        }) as TextChannel;
        createdPanels.push(panel);
      }
      panels.push(panel);
    }

    const next = mergeGuildSecurityConfig(config, {
      tickets: { enabled: true, categoryId: activeCategory.id, panelChannelId: panels[0]?.id ?? null, staffRoleIds: [supportRole.id], topics: setupTopics },
    });
    // Panels are prepared before settings become active, so a database failure never leaves live controls behind.
    for (let index = 0; index < panels.length; index += 1) {
      await publishTopicPanel(panels[index]!, ticketPanel(next.tickets, next.tickets.topics[index]!), interaction.client.user.id);
    }
    await upsertGuildSecuritySettings(interaction.guildId, member.id, next);
    return respond(interaction, "تم إعداد التذاكر. أُنشئت قنوات 🎫・open-ticket و🤝・middleman-ticket و📈・levelup-ticket، وكل قناة تحتوي زر فتح خاصاً بها.");
  } catch (error) {
    await Promise.allSettled(createdPanels.map((panel) => panel.delete("Rolling back incomplete Security Systemix ticket setup")));
    await Promise.allSettled(createdCategories.reverse().map((category) => category.delete("Rolling back incomplete Security Systemix ticket setup")));
    logSafe(`Ticket setup failed in guild ${interaction.guildId}`, error);
    return respond(interaction, "لم يكتمل إعداد التذاكر. راجع صلاحيات Manage Channels وSend Messages ثم أعد الأمر؛ نُظفت القنوات الجديدة إن أمكن.");
  }
}

async function onComponent(interaction: ComponentInteraction) {
  await deferTicketReply(interaction);
  const [action, arg] = interaction.customId.split(":").slice(2);
  const guild = interaction.guild;
  if (!guild) return respond(interaction, "تعذر تحديد السيرفر.");
  const config = await getGuildConfig(guild.id);
  const cfg = config.tickets;
  if (!cfg.enabled) return respond(interaction, "نظام التذاكر غير مفعّل.");
  const member = interaction.member as GuildMember;

  if (action === "open") {
    // Old select menus remain usable during the upgrade; new fixed channels use a direct button.
    const topicId = interaction.isStringSelectMenu() ? interaction.values[0] : arg;
    const topic = cfg.topics.find((item) => item.id === topicId);
    if (!topic || !cfg.categoryId) return respond(interaction, "موضوع أو تصنيف التذاكر غير صالح.");
    const category = guild.channels.cache.get(cfg.categoryId);
    const me = guild.members.me;
    if (!category || category.type !== ChannelType.GuildCategory || !me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return respond(interaction, "إعدادات التذاكر أو صلاحية Manage Channels غير متاحة.");
    }
    const configuredRoleIds = [...new Set([...cfg.staffRoleIds, ...config.general.staffRoleIds])];
    if (!configuredRoleIds.length || configuredRoleIds.includes(guild.id)) {
      return respond(interaction, "عيّن رتبة دعم حقيقية واحدة على الأقل؛ لا يمكن استخدام رتبة @everyone.");
    }
    const roles = supportRoles(guild, config);
    if (roles.length !== configuredRoleIds.length || roles.some((role) => role.managed)) {
      return respond(interaction, "يوجد دور دعم غير موجود أو مُدار من تطبيق آخر. صحّح أدوار فريق الدعم أولاً.");
    }

    let ticket: Awaited<ReturnType<typeof createTicket>> | undefined;
    let channel: Awaited<ReturnType<typeof guild.channels.create>> | undefined;
    try {
      ticket = await createTicket({ guildId: guild.id, openerId: member.id, topic: topic.id, maxOpenPerUser: cfg.maxOpenPerUser });
      channel = await guild.channels.create({
        name: cleanTicketChannelName(`${ticketChannelPrefix(topic.id)}-${ticket.ticketNumber}`),
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...roles.map((role) => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
          { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ],
      });
      await setTicketChannel(guild.id, ticket.id, channel.id);
      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId("tickets", "claim", ticket.id)).setLabel("استلام").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(customId("tickets", "close", ticket.id)).setLabel("إغلاق").setStyle(ButtonStyle.Danger),
      );
      const text = cfg.openMessage.replace(/\{user\}/g, `<@${member.id}>`).slice(0, 1000);
      await channel.send({ content: text, components: [controls], allowedMentions: { users: [member.id], roles: [], parse: [] } });
      return respond(interaction, `تم فتح تذكرتك: <#${channel.id}>`);
    } catch (error) {
      if (channel) await channel.delete("Ticket provisioning failed").catch((cleanupError) => logSafe(`Ticket channel cleanup failed in guild ${guild.id}`, cleanupError));
      if (ticket) await cancelTicketReservation(guild.id, ticket.id, member.id).catch((cleanupError) => logSafe(`Ticket reservation cleanup failed in guild ${guild.id}`, cleanupError));
      if (error instanceof TicketLimitReachedError) return respond(interaction, "بلغت الحد الأقصى للتذاكر المفتوحة.");
      logSafe(`Ticket creation failed in guild ${guild.id}`, error);
      return respond(interaction, "تعذر إنشاء التذكرة حالياً؛ لم تُترك تذكرة صالحة مفتوحة بسبب هذا الخطأ.");
    }
  }

  if ((action === "close" || action === "claim") && arg && /^\d+$/.test(arg)) {
    const ticket = await getTicketByChannel(guild.id, interaction.channelId);
    if (!ticket || ticket.id !== Number(arg) || ticket.status === "closed" || ticket.status === "closing") return respond(interaction, "التذكرة غير متاحة.");
    const staff = isStaffMember(member, config) || cfg.staffRoleIds.some((id) => member.roles.cache.has(id));

    if (action === "claim") {
      if (!staff) return respond(interaction, "استلام التذكرة متاح لفريق الدعم فقط.");
      const claimed = await claimTicket(guild.id, ticket.id, member.id);
      if (claimed === "claimed") return respond(interaction, "تم استلام التذكرة.");
      if (claimed === "already_claimed") return respond(interaction, "هذه التذكرة استلمها عضو دعم آخر بالفعل.");
      return respond(interaction, "التذكرة لم تعد متاحة للاستلام.");
    }

    if (!canManageTicket(member.id, ticket.openerId, staff)) return respond(interaction, "لا يمكنك إغلاق تذكرة شخص آخر.");
    const closingTicket = await beginTicketClose(guild.id, ticket.id);
    if (!closingTicket) return respond(interaction, "التذكرة قيد الإغلاق أو أُغلقت بالفعل.");
    let channelDeleted = !closingTicket.channelId;
    try {
      const ticketChannel = closingTicket.channelId ? await guild.channels.fetch(closingTicket.channelId).catch(() => null) : null;
      if (ticketChannel) {
        await ticketChannel.delete("Ticket closed through Security Systemix");
        channelDeleted = true;
      }
      const finalized = await finishTicketClose(guild.id, ticket.id, member.id);
      if (!finalized) throw new Error("ticket_close_finalize_failed");
      return respond(interaction, "تم إغلاق التذكرة وحذف قناتها. لا يتم حفظ نصوص الرسائل في هذه النسخة.");
    } catch (error) {
      const previousStatus = ticket.status === "claimed" ? "claimed" : "open";
      if (!channelDeleted) {
        await restoreTicketAfterCloseFailure(guild.id, ticket.id, previousStatus).catch((restoreError) => logSafe(`Ticket close recovery failed in guild ${guild.id}`, restoreError));
      }
      logSafe(`Ticket close failed in guild ${guild.id}`, error);
      if (channelDeleted) return respond(interaction, "حُذفت القناة، لكن تعذر توثيق الإغلاق في قاعدة البيانات. لا تفتح تذكرة بديلة؛ راجع مسؤول النظام لمعالجة السجل.");
      return respond(interaction, "لم يُغلق الطلب لأن حذف القناة لم يكتمل. تحقق من صلاحية Manage Channels ثم أعد المحاولة.");
    }
  }
}

export const ticketsModule: SystemixModule = {
  name: "tickets",
  implemented: true,
  commands: [command.toJSON()],
  onCommand: handleCommand,
  componentPrefix: "tickets",
  onComponent,
};
