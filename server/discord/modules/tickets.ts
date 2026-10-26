import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type Guild,
  type GuildMember,
  type Message,
  type CategoryChannel,
  type Role,
  type TextChannel,
} from "discord.js";
import type { ComponentInteraction, SystemixModule } from "../core/types";
import { defaultGuildSecurityConfig, mergeGuildSecurityConfig, type GuildSecurityConfig } from "../config";
import { customId } from "../core/types";
import { getGuildConfig, isStaffMember, logSafe, sendSecurityAlert, systemixEmbed } from "../core/context";
import { loggingDestination, loggingEnabled } from "./logging";
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
export const TICKET_CENTER_CHANNEL_NAME = "🎟️・ticket-center";
const ACTIVE_TICKETS_CATEGORY_NAME = "🔒・active-tickets";
const MANAGED_SUPPORT_ROLE_NAME = "Systemix Support • Bot";
const TICKET_BOT_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.EmbedLinks,
];

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

/** Ticket lifecycle records never contain the private text of a ticket conversation. */
export type TicketLifecycleLogInput = {
  guild: Guild;
  config: GuildSecurityConfig;
  eventType: "opened" | "claimed" | "closed";
  actorId: string;
  openerId: string;
  ticketId: number;
  ticketNumber: number;
  channelId: string | null;
  channelDeleted?: boolean;
  topic?: string;
  openedAt: Date;
  closedAt?: Date;
  closeReason?: string;
};

function ticketLogTimestamp(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "غير متاح";
  return `<t:${Math.floor(date.getTime() / 1_000)}:F>`;
}

function ticketLogTopic(input: TicketLifecycleLogInput): string {
  return input.config.tickets.topics.find((topic) => topic.id === input.topic)?.label
    ?? input.topic
    ?? "غير محدد";
}

/** Builds a readable Arabic summary without retaining any ticket message text. */
export function ticketLifecycleLogFields(input: TicketLifecycleLogInput): Array<{ name: string; value: string; inline: boolean }> {
  const channel = input.channelId
    ? input.channelDeleted ? `\`${input.channelId}\`\nحُذفت بعد الإغلاق` : `<#${input.channelId}>`
    : "غير متاحة";
  const identity = (id: string) => `<@${id}>`;
  const ticketNumber = `#${input.ticketNumber}`;
  const topic = ticketLogTopic(input);

  if (input.eventType === "closed") {
    return [
      { name: "رقم التذكرة", value: ticketNumber, inline: true },
      { name: "نوع التذكرة", value: topic, inline: true },
      { name: "صاحب التذكرة", value: identity(input.openerId), inline: true },
      { name: "أُغلقت بواسطة", value: identity(input.actorId), inline: true },
      { name: "وقت الفتح", value: ticketLogTimestamp(input.openedAt), inline: true },
      { name: "وقت الإغلاق", value: ticketLogTimestamp(input.closedAt), inline: true },
      { name: "سبب الإغلاق", value: input.closeReason ?? "إغلاق يدوي", inline: false },
      { name: "القناة", value: channel, inline: false },
    ];
  }

  return [
    { name: "رقم التذكرة", value: ticketNumber, inline: true },
    { name: "نوع التذكرة", value: topic, inline: true },
    { name: input.eventType === "opened" ? "فُتحت بواسطة" : "استلمها", value: identity(input.actorId), inline: true },
    { name: "صاحب التذكرة", value: identity(input.openerId), inline: true },
    { name: "وقت الفتح", value: ticketLogTimestamp(input.openedAt), inline: true },
    { name: "القناة", value: channel, inline: true },
  ];
}

/**
 * Logging is non-blocking after ticket state succeeds, so a delivery outage never
 * leaves a customer with a half-created or half-closed ticket.
 */
async function writeTicketLifecycleLog(input: TicketLifecycleLogInput): Promise<void> {
  if (!loggingEnabled(input.config, "ticketEvents")) return;
  try {
    await recordSecurityEvent({
      guildId: input.guild.id,
      eventType: `ticket:${input.eventType}`,
      actorId: input.actorId,
      targetId: input.openerId,
      severity: "low",
      details: {
        ticketId: input.ticketId,
        ticketNumber: input.ticketNumber,
        channelId: input.channelId,
        openerId: input.openerId,
        topic: input.topic ?? null,
        openedAt: input.openedAt.toISOString(),
        closedAt: input.closedAt?.toISOString() ?? null,
        closeReason: input.closeReason ?? null,
      },
    });
  } catch (error) {
    logSafe(`Ticket ${input.eventType} audit write failed in guild ${input.guild.id}`, error);
    return;
  }

  const destination = loggingDestination(input.config, "ticketEvents");
  if (!destination) return;
  const eventNames = { opened: "🎫 تم فتح تذكرة", claimed: "🤝 تم استلام التذكرة", closed: "🔒 تم إغلاق التذكرة" } as const;
  const botAvatar = input.guild.client.user?.displayAvatarURL() ?? null;
  await sendSecurityAlert(input.guild, input.config, destination, {
    embeds: [systemixEmbed({
      title: eventNames[input.eventType],
      description: input.eventType === "closed" ? "أُغلقت التذكرة بنجاح وسُجلت تفاصيلها أدناه." : "سُجلت عملية التذكرة في Systemix.",
      tone: input.eventType === "closed" ? "success" : "info",
      fields: ticketLifecycleLogFields(input),
      config: input.config,
      footer: "سجل التذاكر · لا يُحفظ محتوى المحادثة",
      thumbnail: botAvatar,
    })],
    allowedMentions: { parse: [] },
  }).catch((error) => logSafe(`Ticket ${input.eventType} log delivery failed in guild ${input.guild.id}`, error));
}

function supportRoles(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"], config: Awaited<ReturnType<typeof getGuildConfig>>) {
  const roleIds = [...new Set([...config.tickets.staffRoleIds, ...config.general.staffRoleIds])]
    .filter((id) => id !== guild.id);
  return roleIds.map((id) => guild.roles.cache.get(id)).filter((role): role is NonNullable<typeof role> => Boolean(role));
}

function ticketCommand(name: "ticket" | "systemix-tickets") {
  return new SlashCommandBuilder().setName(name).setDescription("إدارة التذاكر")
    .addSubcommand((sub) => sub.setName("panel").setDescription("نشر أو تحديث لوحة فتح التذاكر"))
    .addSubcommand((sub) => sub.setName("setup").setDescription("إعداد نظام التذاكر وإنشاء لوحته تلقائياً")
      .addRoleOption((option) => option.setName("support-role").setDescription("رتبة فريق الدعم التي ترى التذاكر").setRequired(true)));
}

const command = ticketCommand("ticket");
const systemixTicketsCommand = ticketCommand("systemix-tickets");

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

/** A single polished menu can expose up to ten owner-configured ticket departments. */
function ticketCenterPanel(cfg: Awaited<ReturnType<typeof getGuildConfig>>["tickets"]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId("tickets", "open"))
    .setPlaceholder("اختر القسم الذي يناسب طلبك")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(cfg.topics.slice(0, 10).map((topic) => ({
      label: topic.label.slice(0, 100),
      description: topic.description.slice(0, 100) || "فتح تذكرة خاصة",
      value: topic.id,
      ...(topic.emoji ? { emoji: topic.emoji } : {}),
    })));
  return {
    embeds: [new EmbedBuilder()
      .setTitle(cfg.panelTitle)
      .setDescription(`${cfg.panelDescription}\n\nاختر قسمك من القائمة أدناه. تفتح كل تذكرة في قناة خاصة لا يراها إلا صاحبها وفريق الدعم.`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    allowedMentions: { parse: [] as [] },
  };
}

function hasTicketCategoryAccess(category: CategoryChannel, member: GuildMember | null): boolean {
  if (!member) return false;
  const permissions = category.permissionsFor(member);
  return Boolean(permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.SendMessages,
  ]));
}

/** Prefer the category holding the saved ticket centre over a same-named category. */
export function findConfiguredTicketPanelCategory(guild: Guild, member: GuildMember | null, config: GuildSecurityConfig): CategoryChannel | null {
  const centerId = config.tickets.panelChannelId;
  if (!centerId) return null;
  const center = guild.channels.cache.get(centerId);
  if (!center?.parentId) return null;
  const parent = guild.channels.cache.get(center.parentId);
  return parent?.type === ChannelType.GuildCategory && hasTicketCategoryAccess(parent, member) ? parent : null;
}

/** Prefer the active-ticket category stored in the guild configuration. */
export function findConfiguredActiveTicketCategory(guild: Guild, member: GuildMember | null, config: GuildSecurityConfig): CategoryChannel | null {
  const categoryId = config.tickets.categoryId;
  if (!categoryId) return null;
  const category = guild.channels.cache.get(categoryId);
  return category?.type === ChannelType.GuildCategory && hasTicketCategoryAccess(category, member) ? category : null;
}

function findPanelCategory(
  guild: Guild,
  member: GuildMember | null,
  config: GuildSecurityConfig,
): CategoryChannel | null {
  const configuredCategory = findConfiguredTicketPanelCategory(guild, member, config);
  if (configuredCategory) return configuredCategory;
  return (guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildCategory) return false;
    return (channel.name === PANEL_CATEGORY_NAME || channel.name === LEGACY_PANEL_CATEGORY_NAME)
      && hasTicketCategoryAccess(channel, member);
  }) ?? null) as CategoryChannel | null;
}

function findActiveTicketCategory(guild: Guild, member: GuildMember | null, config: GuildSecurityConfig): CategoryChannel | null {
  const configuredCategory = findConfiguredActiveTicketCategory(guild, member, config);
  if (configuredCategory) return configuredCategory;
  return (guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory
    && channel.name === ACTIVE_TICKETS_CATEGORY_NAME
    && hasTicketCategoryAccess(channel, member)) ?? null) as CategoryChannel | null;
}

function findTextChannel(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"], categoryId: string, name: string): TextChannel | null {
  const channel = guild.channels.cache.find((candidate) => candidate.parentId === categoryId
    && candidate.type === ChannelType.GuildText
    && candidate.name === name) ?? null;
  return channel as TextChannel | null;
}

function findTicketCenter(guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"], categoryId: string): TextChannel | null {
  return findTextChannel(guild, categoryId, TICKET_CENTER_CHANNEL_NAME);
}

/** A just-invited bot can have an empty member cache despite valid Discord permissions. */
async function resolveBotMember(guild: Guild): Promise<GuildMember | null> {
  return guild.members.me ?? guild.members.fetchMe().catch(() => null);
}

/** A ticket support role must be non-managed and below the bot in Discord's hierarchy. */
export function isUsableTicketSupportRole(
  role: Pick<Role, "managed" | "position">,
  botHighestRolePosition: number,
): boolean {
  return !role.managed && role.position < botHighestRolePosition;
}

function findProvisionSupportRole(guild: Guild, me: GuildMember): Role | null {
  const acceptedNames = new Set(["systemix support", MANAGED_SUPPORT_ROLE_NAME.toLowerCase()]);
  const candidates = [...guild.roles.cache.values()]
    .filter((role) => acceptedNames.has(role.name.toLowerCase()) && isUsableTicketSupportRole(role, me.roles.highest.position))
    .sort((left, right) => right.position - left.position);
  return candidates[0] ?? null;
}

/** Repair old panel channels before publishing, without changing member or staff access. */
async function ensureTicketBotChannelPermissions(channel: CategoryChannel | TextChannel, botUserId: string): Promise<void> {
  await channel.permissionOverwrites.edit(botUserId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    ManageChannels: true,
    EmbedLinks: true,
  }, { reason: "Security Systemix ticket panel permissions" });
}

/** Ticket panels are public read-only entry points; active tickets remain private elsewhere. */
async function ensurePublicTicketPanelPermissions(channel: TextChannel, guildId: string, botUserId: string): Promise<void> {
  await ensureTicketBotChannelPermissions(channel, botUserId);
  await channel.permissionOverwrites.edit(guildId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
  }, { reason: "Security Systemix public ticket panel permissions" });
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
  payload: ReturnType<typeof ticketPanel> | ReturnType<typeof ticketCenterPanel>,
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
  for (const topic of cfg.topics.filter((item) => item.id in TICKET_PANEL_CHANNELS)) {
    const channel = findTextChannel(guild, panelCategoryId, ticketPanelChannelName(topic.id));
    if (!channel) throw new Error(`ticket_panel_channel_missing:${topic.id}`);
    await publishTopicPanel(channel, ticketPanel(cfg, topic), botUserId);
  }
}

async function publishTicketCenter(
  guild: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]["guild"],
  cfg: Awaited<ReturnType<typeof getGuildConfig>>["tickets"],
  panelCategoryId: string,
  botUserId: string,
): Promise<void> {
  const center = findTicketCenter(guild, panelCategoryId);
  if (!center) throw new Error("ticket_center_channel_missing");
  await publishTopicPanel(center, ticketCenterPanel(cfg), botUserId);
}

async function handleCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]) {
  await deferTicketReply(interaction);
  const config = await getGuildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "setup") return setupTicketSystem(interaction, config);
  const cfg = config.tickets;
  if (!cfg.enabled) return respond(interaction, "نظام التذاكر غير مفعّل.");
  const member = interaction.member as GuildMember;
  const mayManagePanels = member.id === interaction.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild) || isStaffMember(member, config);
  if (!mayManagePanels) return respond(interaction, "هذا الأمر مخصص لمالك السيرفر أو فريق الدعم.");
  if (subcommand !== "panel") return respond(interaction, "الأمر غير متاح.");
  const category = findPanelCategory(interaction.guild, await resolveBotMember(interaction.guild), config);
  if (!category) return respond(interaction, "لا توجد قنوات لوحات التذاكر بعد. استخدم /ticket setup أولاً.");
  if (cfg.topics.length === 0) return respond(interaction, "أضف نوع تذكرة واحداً على الأقل قبل نشر اللوحة.");

  try {
    await publishTicketCenter(interaction.guild, cfg, category.id, interaction.client.user.id);
    await publishTicketPanels(interaction.guild, cfg, category.id, interaction.client.user.id);
    return respond(interaction, "تم تحديث مركز التذاكر والأقسام المخصصة.");
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

  const me = await resolveBotMember(interaction.guild);
  if (!me?.permissions.has(PermissionFlagsBits.ViewChannel) || !me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.SendMessages)) {
    return respond(interaction, "لا يملك البوت حالياً View Channel وManage Channels وSend Messages. أعطه هذه الصلاحيات ثم أعد /ticket setup.");
  }

  const createdCategories: Array<{ delete: (reason?: string) => Promise<unknown> }> = [];
  const createdPanels: TextChannel[] = [];
  let panelCategory = findPanelCategory(interaction.guild, me, config);
  let activeCategory = findActiveTicketCategory(interaction.guild, me, config);
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
          { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
          { id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
        reason: "Security Systemix private ticket category",
      });
      createdCategories.push(activeCategory);
    }
    await ensureTicketBotChannelPermissions(activeCategory, me.id);

    const setupTopics = config.tickets.topics.length ? config.tickets.topics : defaultGuildSecurityConfig.tickets.topics;
    let center = findTicketCenter(interaction.guild, panelCategory.id);
    if (!center) {
      center = await interaction.guild.channels.create({
        name: TICKET_CENTER_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: panelCategory.id,
        permissionOverwrites: [
          { id: interaction.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
          { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
        ],
        reason: "Security Systemix ticket center",
      }) as TextChannel;
      createdPanels.push(center);
    }
    await ensurePublicTicketPanelPermissions(center, interaction.guild.id, me.id);
    for (const topic of setupTopics.filter((item) => item.id in TICKET_PANEL_CHANNELS)) {
      let panel = findTextChannel(interaction.guild, panelCategory.id, ticketPanelChannelName(topic.id));
      if (!panel) {
        panel = await interaction.guild.channels.create({
          name: ticketPanelChannelName(topic.id),
          type: ChannelType.GuildText,
          parent: panelCategory.id,
          permissionOverwrites: [
            { id: interaction.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
            { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
          ],
          reason: "Security Systemix ticket panel",
        }) as TextChannel;
        createdPanels.push(panel);
      }
      await ensurePublicTicketPanelPermissions(panel, interaction.guild.id, me.id);
    }

    const next = mergeGuildSecurityConfig(config, {
      tickets: { enabled: true, categoryId: activeCategory.id, panelChannelId: center.id, staffRoleIds: [supportRole.id], topics: setupTopics },
    });
    // Panels are prepared before settings become active, so a database failure never leaves live controls behind.
    await publishTicketCenter(interaction.guild, next.tickets, panelCategory.id, interaction.client.user.id);
    await publishTicketPanels(interaction.guild, next.tickets, panelCategory.id, interaction.client.user.id);
    await upsertGuildSecuritySettings(interaction.guildId, member.id, next);
    return respond(interaction, "تم إعداد مركز التذاكر. أُنشئت قناة 🎟️・ticket-center بقائمة الأقسام، وقنوات مباشرة للوسيط ورفع المستوى والطلبات الأخرى.");
  } catch (error) {
    await Promise.all(createdPanels.map((panel) => panel.delete("Rolling back incomplete Security Systemix ticket setup").catch(() => undefined)));
    await Promise.all(createdCategories.reverse().map((category) => category.delete("Rolling back incomplete Security Systemix ticket setup").catch(() => undefined)));
    logSafe(`Ticket setup failed in guild ${interaction.guildId}`, error);
    if (typeof error === "object" && error !== null && "code" in error && [50001, 50013].includes(Number(error.code))) {
      return respond(interaction, "لا يستطيع البوت الوصول إلى قسم التذاكر المختار. منحه View Channel وManage Channels ثم أعد /systemix-tickets setup.");
    }
    return respond(interaction, "لم يكتمل إعداد التذاكر. راجع صلاحيات Manage Channels وSend Messages ثم أعد الأمر؛ نُظفت القنوات الجديدة إن أمكن.");
  }
}

export type TicketProvisionResult = { createdPanels: number; createdSupportRole: boolean; reusedPanelCategory: boolean };

/** Owner-panel equivalent of `/systemix-tickets setup`; it creates no privilege-bearing role. */
export async function provisionTicketsForGuild(guild: Guild, actorId: string): Promise<TicketProvisionResult> {
  const me = await resolveBotMember(guild);
  if (!me?.permissions.has(PermissionFlagsBits.ViewChannel) || !me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error("bot_missing_ticket_setup_permissions");
  }
  await recordSecurityEvent({
    guildId: guild.id,
    eventType: "ticket:owner_setup_precondition",
    actorId,
    severity: "medium",
    details: { requested: "three_ticket_panels" },
  });

  const createdCategories: Array<{ delete: (reason?: string) => Promise<unknown> }> = [];
  const createdPanels: TextChannel[] = [];
  let createdSupportRole: { delete: (reason?: string) => Promise<unknown> } | null = null;
  let existingPanelCategory: CategoryChannel | null = null;
  let panelCategory: CategoryChannel | null = null;
  let activeCategory: CategoryChannel | null = null;
  let stage = "support_role";
  try {
    const selectionConfig = await getGuildConfig(guild.id);
    existingPanelCategory = findPanelCategory(guild, me, selectionConfig);
    panelCategory = existingPanelCategory;
    activeCategory = findActiveTicketCategory(guild, me, selectionConfig);
    let supportRole = findProvisionSupportRole(guild, me);
    if (!supportRole) {
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error("bot_missing_ticket_role_permissions");
      supportRole = await guild.roles.create({ name: MANAGED_SUPPORT_ROLE_NAME, permissions: [], reason: "Security Systemix ticket support role" });
      createdSupportRole = supportRole;
    }
    stage = "panel_category";
    if (!panelCategory) {
      panelCategory = await guild.channels.create({ name: PANEL_CATEGORY_NAME, type: ChannelType.GuildCategory, reason: "Security Systemix owner ticket panel setup" });
      createdCategories.push(panelCategory);
    }
    stage = "active_ticket_category";
    if (!activeCategory) {
      activeCategory = await guild.channels.create({
        name: ACTIVE_TICKETS_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
          { id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
        reason: "Security Systemix owner private ticket category",
      });
      createdCategories.push(activeCategory);
    }

    stage = "active_ticket_permissions";
    await ensureTicketBotChannelPermissions(activeCategory, me.id);
    const config = await getGuildConfig(guild.id);
    const setupTopics = config.tickets.topics.length ? config.tickets.topics : defaultGuildSecurityConfig.tickets.topics;
    let center = findTicketCenter(guild, panelCategory.id);
    stage = "ticket_center";
    if (!center) {
      center = await guild.channels.create({
        name: TICKET_CENTER_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: panelCategory.id,
        permissionOverwrites: [
          { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
          { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
        ],
        reason: "Security Systemix owner ticket center",
      }) as TextChannel;
      createdPanels.push(center);
    }
    stage = "ticket_center_permissions";
    await ensurePublicTicketPanelPermissions(center, guild.id, me.id);
    stage = "topic_panels";
    for (const topic of setupTopics.filter((item) => item.id in TICKET_PANEL_CHANNELS)) {
      let panel = findTextChannel(guild, panelCategory.id, ticketPanelChannelName(topic.id));
      if (!panel) {
        panel = await guild.channels.create({
          name: ticketPanelChannelName(topic.id), type: ChannelType.GuildText, parent: panelCategory.id,
          permissionOverwrites: [
            { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
            { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
          ],
          reason: "Security Systemix owner ticket panel",
        }) as TextChannel;
        createdPanels.push(panel);
      }
      stage = "topic_panel_permissions";
      await ensurePublicTicketPanelPermissions(panel, guild.id, me.id);
    }
    const next = mergeGuildSecurityConfig(config, {
      tickets: { enabled: true, categoryId: activeCategory.id, panelChannelId: center.id, staffRoleIds: [supportRole.id], topics: setupTopics },
    });
    stage = "publish_panels";
    await publishTicketCenter(guild, next.tickets, panelCategory.id, me.id);
    await publishTicketPanels(guild, next.tickets, panelCategory.id, me.id);
    stage = "save_configuration";
    await upsertGuildSecuritySettings(guild.id, actorId, next);
    return { createdPanels: createdPanels.length, createdSupportRole: Boolean(createdSupportRole), reusedPanelCategory: Boolean(existingPanelCategory) };
  } catch (error) {
    await Promise.all(createdPanels.map((panel) => panel.delete("Rolling back incomplete Security Systemix owner ticket setup").catch(() => undefined)));
    await Promise.all(createdCategories.reverse().map((category) => category.delete("Rolling back incomplete Security Systemix owner ticket setup").catch(() => undefined)));
    if (createdSupportRole) await createdSupportRole.delete("Rolling back incomplete Security Systemix owner ticket setup").catch(() => undefined);
    logSafe(`Ticket owner provisioning failed in guild ${guild.id} at ${stage}`, error);
    if (typeof error === "object" && error !== null && "code" in error && [50001, 50013].includes(Number(error.code))) {
      throw new Error("bot_missing_ticket_setup_permissions");
    }
    throw error;
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
    const me = await resolveBotMember(guild);
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
          { id: me.id, allow: TICKET_BOT_CHANNEL_PERMISSIONS },
        ],
      });
      await setTicketChannel(guild.id, ticket.id, channel.id);
      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId("tickets", "claim", ticket.id)).setLabel("استلام التذكرة").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(customId("tickets", "close", ticket.id)).setLabel("إغلاق التذكرة").setStyle(ButtonStyle.Danger),
      );
      const text = cfg.openMessage.replace(/\{user\}/g, `<@${member.id}>`).slice(0, 1000);
      const ticketCard = new EmbedBuilder()
        .setTitle(`${topic.emoji || "🎫"} تذكرة #${ticket.ticketNumber} • ${topic.label}`)
        .setDescription(text)
        .addFields(
          { name: "صاحب التذكرة", value: `<@${member.id}>`, inline: true },
          { name: "القسم", value: topic.label, inline: true },
          { name: "الحالة", value: "بانتظار فريق الدعم", inline: true },
          { name: "وقت الفتح", value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
          { name: "فريق الدعم", value: roles.map((role) => `<@&${role.id}>`).join(" · ").slice(0, 1_000) || "غير محدد", inline: false },
        )
        .setFooter({ text: `Security Systemix • رقم التذكرة ${ticket.ticketNumber}` })
        .setTimestamp();
      await channel.send({ content: `<@${member.id}>`, embeds: [ticketCard], components: [controls], allowedMentions: { users: [member.id], roles: [], parse: [] } });
      void writeTicketLifecycleLog({
        guild, config, eventType: "opened", actorId: member.id, openerId: member.id,
        ticketId: ticket.id, ticketNumber: ticket.ticketNumber, channelId: channel.id, topic: topic.label,
        openedAt: ticket.createdAt,
      });
      return respond(interaction, `تم فتح تذكرتك: <#${channel.id}>`);
    } catch (error) {
      if (channel) await channel.delete("Ticket provisioning failed").catch((cleanupError) => logSafe(`Ticket channel cleanup failed in guild ${guild.id}`, cleanupError));
      if (ticket) await cancelTicketReservation(guild.id, ticket.id, member.id).catch((cleanupError) => logSafe(`Ticket reservation cleanup failed in guild ${guild.id}`, cleanupError));
      if (error instanceof TicketLimitReachedError) return respond(interaction, "بلغت الحد الأقصى للتذاكر المفتوحة.");
      logSafe(`Ticket creation failed in guild ${guild.id}`, error);
      return respond(interaction, "تعذر إنشاء التذكرة حالياً؛ لم تُترك تذكرة صالحة مفتوحة بسبب هذا الخطأ.");
    }
  }

  if ((action === "close" || action === "closeconfirm" || action === "closecancel" || action === "claim") && arg && /^\d+$/.test(arg)) {
    const ticket = await getTicketByChannel(guild.id, interaction.channelId);
    if (!ticket || ticket.id !== Number(arg) || ticket.status === "closed" || ticket.status === "closing") return respond(interaction, "التذكرة غير متاحة.");
    const staff = isStaffMember(member, config) || cfg.staffRoleIds.some((id) => member.roles.cache.has(id));

    if (action === "claim") {
      if (!staff) return respond(interaction, "استلام التذكرة متاح لفريق الدعم فقط.");
      const claimed = await claimTicket(guild.id, ticket.id, member.id);
      if (claimed === "claimed") {
        void writeTicketLifecycleLog({
          guild, config, eventType: "claimed", actorId: member.id, openerId: ticket.openerId,
          ticketId: ticket.id, ticketNumber: ticket.ticketNumber, channelId: ticket.channelId, topic: ticket.topic,
          openedAt: ticket.createdAt,
        });
        return respond(interaction, "تم استلام التذكرة.");
      }
      if (claimed === "already_claimed") return respond(interaction, "هذه التذكرة استلمها عضو دعم آخر بالفعل.");
      return respond(interaction, "التذكرة لم تعد متاحة للاستلام.");
    }

    if (!canManageTicket(member.id, ticket.openerId, staff)) return respond(interaction, "لا يمكنك إغلاق تذكرة شخص آخر.");
    if (action === "closecancel") return respond(interaction, "أُلغي إغلاق التذكرة؛ بقيت مفتوحة.");
    if (action === "close") {
      const confirmation = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId("tickets", "closeconfirm", ticket.id)).setLabel("نعم، أغلق التذكرة").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(customId("tickets", "closecancel", ticket.id)).setLabel("إلغاء").setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({ content: "هل أنت متأكد؟ سيُحذف Channel التذكرة ثم يوثق البوت عملية الإغلاق في السجل.", components: [confirmation], allowedMentions: { parse: [] } });
      return;
    }
    const closingTicket = await beginTicketClose(guild.id, ticket.id);
    if (!closingTicket) return respond(interaction, "التذكرة قيد الإغلاق أو أُغلقت بالفعل.");
    let channelDeleted = !closingTicket.channelId;
    try {
      const ticketChannel = closingTicket.channelId ? await guild.channels.fetch(closingTicket.channelId).catch(() => null) : null;
      if (ticketChannel) {
        await ticketChannel.delete("Ticket closed through Security Systemix");
        channelDeleted = true;
      }
      const closedAt = new Date();
      const finalized = await finishTicketClose(guild.id, ticket.id, member.id, closedAt);
      if (!finalized) throw new Error("ticket_close_finalize_failed");
      void writeTicketLifecycleLog({
        guild, config, eventType: "closed", actorId: member.id, openerId: ticket.openerId,
        ticketId: ticket.id, ticketNumber: ticket.ticketNumber, channelId: closingTicket.channelId, channelDeleted: true,
        topic: ticket.topic, openedAt: ticket.createdAt, closedAt, closeReason: "إغلاق يدوي من لوحة التذكرة",
      });
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
  commands: [command.toJSON(), systemixTicketsCommand.toJSON()],
  onCommand: handleCommand,
  componentPrefix: "tickets",
  onComponent,
};
