import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type APIEmbedField,
  type Guild,
  type GuildMember,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  type RepliableInteraction,
  type Role,
} from "discord.js";
import type { ModCaseRow } from "../../../drizzle/schema";
import { CASE_TYPE_LABELS } from "../../../shared/systemix-api";
import * as db from "../../db";
import {
  DANGEROUS_PERMISSION_NAMES,
  defaultGuildSecurityConfig,
  normalizeGuildSecurityConfig,
  type GuildSecurityConfig,
} from "../config";
import { RollingWriteBudget } from "../limits";
import { safeDiscordErrorCode } from "../security";
import { createCase, type NewModCase } from "../store/cases";
import { bumpStat } from "../store/stats";

export { bumpStat } from "../store/stats";

export function logSafe(message: string, error?: unknown): void {
  const code = error ? safeDiscordErrorCode(error) : "";
  console.warn(`[Systemix] ${message}${code ? ` (${code})` : ""}`);
}

/** Normalized guild configuration. Defaults apply only after a successful read with no saved row. */
export async function getGuildConfig(guildId: string): Promise<GuildSecurityConfig> {
  try {
    const row = await db.getGuildSecuritySettings(guildId);
    return normalizeGuildSecurityConfig(row?.settings ?? defaultGuildSecurityConfig);
  } catch (error) {
    logSafe(`Config read failed for guild ${guildId}`, error);
    throw new Error("guild_security_config_unavailable");
  }
}

/** True when automated enforcement (punishments, lockdowns) is allowed. Observe mode only alerts. */
export function enforcementEnabled(config: GuildSecurityConfig): boolean {
  return config.mode === "protect";
}

// ---------------------------------------------------------------------------
// Embeds

export type Tone = "brand" | "info" | "success" | "warning" | "danger";
const TONE_COLORS: Record<Tone, number> = {
  brand: 0xb7f47b,
  info: 0x89c9ef,
  success: 0x6fdc9a,
  warning: 0xedbd75,
  danger: 0xff7779,
};

export function toneColor(tone: Tone, config?: GuildSecurityConfig | null): number {
  if (tone === "brand" && config?.general.embedColor) return Number.parseInt(config.general.embedColor.slice(1), 16);
  return TONE_COLORS[tone];
}

export function systemixEmbed(options: {
  title?: string;
  description?: string;
  tone?: Tone;
  fields?: APIEmbedField[];
  config?: GuildSecurityConfig | null;
  footer?: string;
  thumbnail?: string | null;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(toneColor(options.tone ?? "brand", options.config))
    .setFooter({ text: options.footer ? `Security Systemix · ${options.footer}` : "Security Systemix" })
    .setTimestamp(new Date());
  if (options.title) embed.setTitle(options.title.slice(0, 256));
  if (options.description) embed.setDescription(options.description.slice(0, 4096));
  if (options.fields?.length) embed.addFields(options.fields.slice(0, 25).map((field) => ({ ...field, value: field.value.slice(0, 1024) || "—" })));
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  return embed;
}

// ---------------------------------------------------------------------------
// Sending

const guildSendBudgets = new Map<string, RollingWriteBudget>();
function guildBudget(guildId: string): RollingWriteBudget {
  let budget = guildSendBudgets.get(guildId);
  if (!budget) {
    if (guildSendBudgets.size > 5_000) guildSendBudgets.clear();
    budget = new RollingWriteBudget(40, 60_000, 15);
    guildSendBudgets.set(guildId, budget);
  }
  return budget;
}

/**
 * Sends to a guild text channel if it exists and the bot can post there.
 * Mentions are disabled unless the payload sets `allowedMentions`. Returns null instead of throwing.
 */
export async function sendToChannel(
  guild: Guild,
  channelId: string | null | undefined,
  payload: MessageCreateOptions,
  options: { priority?: boolean } = {},
): Promise<Message | null> {
  if (!channelId) return null;
  try {
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return null;
    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;
    if (payload.embeds?.length && !perms.has(PermissionFlagsBits.EmbedLinks)) return null;
    if (!guildBudget(guild.id).tryConsume(options.priority ?? false)) return null;
    return await channel.send({ allowedMentions: { parse: [] }, ...payload });
  } catch (error) {
    logSafe(`Send failed in guild ${guild.id}`, error);
    return null;
  }
}

/** Sends a security alert to the module channel, falling back to the general security log channel. */
export async function sendSecurityAlert(
  guild: Guild,
  config: GuildSecurityConfig,
  moduleChannelId: string | null,
  payload: MessageCreateOptions,
): Promise<Message | null> {
  return sendToChannel(guild, moduleChannelId ?? config.general.securityLogChannelId, payload, { priority: true });
}

/** Best-effort DM. Never throws (closed DMs are common). */
export async function dmMember(member: GuildMember | { send: GuildMember["send"] }, payload: MessageCreateOptions): Promise<boolean> {
  try {
    await member.send({ allowedMentions: { parse: [] }, ...payload });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Interaction replies

export async function replyEphemeral(
  interaction: RepliableInteraction,
  content: string | Omit<InteractionReplyOptions, "flags">,
): Promise<void> {
  const payload = typeof content === "string" ? { content } : content;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as never);
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as never);
    }
  } catch (error) {
    logSafe("Interaction reply failed", error);
  }
}

export function errorEmbed(message: string): EmbedBuilder {
  return systemixEmbed({ tone: "danger", description: `⛔ ${message}` });
}

export function successEmbed(message: string, config?: GuildSecurityConfig | null): EmbedBuilder {
  return systemixEmbed({ tone: "success", description: `✅ ${message}`, config });
}

export async function replyError(interaction: RepliableInteraction, message: string): Promise<void> {
  await replyEphemeral(interaction, { embeds: [errorEmbed(message)] });
}

// ---------------------------------------------------------------------------
// Permissions and hierarchy

export function isStaffMember(member: GuildMember, config: GuildSecurityConfig): boolean {
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return config.general.staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function hasAnyRole(member: GuildMember, roleIds: readonly string[]): boolean {
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/** Actor may act on target: owner always may; otherwise the actor's highest role must be strictly higher. */
export function actorOutranks(actor: GuildMember, target: GuildMember): boolean {
  if (target.id === target.guild.ownerId) return false;
  if (actor.id === actor.guild.ownerId) return true;
  return actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

/** Exempt from automated security actions: owner, the bot itself, allowlisted IDs/roles, administrators. */
export function isTrustedActor(member: GuildMember | null, config: GuildSecurityConfig, extraIds: readonly string[] = []): boolean {
  if (!member) return false;
  if (member.id === member.guild.ownerId || member.id === member.client.user.id) return true;
  if (config.antiNuke.allowlistedActorIds.includes(member.id) || extraIds.includes(member.id)) return true;
  return hasAnyRole(member, config.antiNuke.allowlistedRoleIds);
}

export function dangerousPermissionsOf(role: Role): string[] {
  return DANGEROUS_PERMISSION_NAMES.filter((name) => role.permissions.has(PermissionFlagsBits[name]));
}

export function isDangerousRole(role: Role): boolean {
  return dangerousPermissionsOf(role).length > 0;
}

/** Bot can assign/remove this role: not managed, not @everyone, below the bot's highest role. */
export function isAssignableRole(role: Role): boolean {
  const me = role.guild.members.me;
  if (!me || role.managed || role.id === role.guild.id) return false;
  return me.roles.highest.comparePositionTo(role) > 0 && me.permissions.has(PermissionFlagsBits.ManageRoles);
}

/** Safe to hand to members automatically: assignable and holds no dangerous permission. */
export function isSafeGrantRole(role: Role): boolean {
  return isAssignableRole(role) && !isDangerousRole(role);
}

// ---------------------------------------------------------------------------
// Text helpers

export function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

const DURATION_UNITS: Record<string, number> = {
  s: 1, sec: 1, ث: 1,
  m: 60, min: 60, د: 60,
  h: 3_600, hr: 3_600, س: 3_600,
  d: 86_400, day: 86_400, ي: 86_400,
  w: 604_800, week: 604_800, أ: 604_800,
};

/** Parses "10m", "2h", "1d", "30s", "1w" (also Arabic ث/د/س/ي/أ). A bare number means minutes. */
export function parseDuration(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.trim().toLowerCase().match(/^(\d{1,6})\s*([a-z\u0600-\u06ff]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ? DURATION_UNITS[match[2]] : 60;
  if (!unit || value <= 0) return null;
  return value * unit;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} ثانية`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} دقيقة`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.round((seconds % 3_600) / 60);
    return minutes ? `${hours} ساعة و${minutes} دقيقة` : `${hours} ساعة`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3_600);
  return hours ? `${days} يوم و${hours} ساعة` : `${days} يوم`;
}

export function discordTimestamp(date: Date | number, style: "R" | "f" | "F" | "d" | "t" = "R"): string {
  const ms = typeof date === "number" ? date : date.getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

// ---------------------------------------------------------------------------
// Events and cases

const eventBudget = new RollingWriteBudget(1_000, 60_000, 100);

/** Budgeted security-event write. Returns false on a budget or database failure. */
export async function recordEvent(event: db.NewSecurityEvent): Promise<boolean> {
  if (!eventBudget.tryConsume(event.severity === "high")) return false;
  try {
    await db.recordSecurityEvent(event);
    if (event.severity !== "low") bumpStat(event.guildId, "threats");
    return true;
  } catch (error) {
    logSafe(`Event write failed for guild ${event.guildId}`, error);
    return false;
  }
}

/**
 * Persists a moderation case, posts it to the mod-log (and logging channel when enabled) and bumps stats.
 * Returns the stored row, or null when the database is unavailable.
 */
export async function recordCase(guild: Guild, config: GuildSecurityConfig, input: Omit<NewModCase, "guildId">): Promise<ModCaseRow | null> {
  let row: ModCaseRow;
  try {
    row = await createCase({ ...input, guildId: guild.id });
  } catch (error) {
    logSafe(`Case write failed for guild ${guild.id}`, error);
    return null;
  }
  bumpStat(guild.id, row.source === "auto" ? "autoActions" : "modActions");
  const embed = caseEmbed(row, config);
  const targets = new Set<string>();
  if (config.general.modLogChannelId) targets.add(config.general.modLogChannelId);
  if (config.logging.enabled && config.logging.moderation && config.logging.channelId) targets.add(config.logging.channelId);
  for (const channelId of targets) await sendToChannel(guild, channelId, { embeds: [embed] });
  return row;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "يدوي",
  auto: "تلقائي",
  delegation: "تفويض",
  dashboard: "لوحة التحكم",
};

export function caseEmbed(row: ModCaseRow, config?: GuildSecurityConfig | null): EmbedBuilder {
  const label = CASE_TYPE_LABELS[row.type] ?? row.type;
  const destructive = ["ban", "kick", "softban", "antinuke", "strip_roles", "honeypot"].includes(row.type);
  const fields: APIEmbedField[] = [
    { name: "العضو", value: row.targetId ? `<@${row.targetId}> \`${row.targetId}\`` : "—", inline: true },
    { name: "المنفّذ", value: `<@${row.moderatorId}>`, inline: true },
    { name: "المصدر", value: SOURCE_LABELS[row.source] ?? row.source, inline: true },
  ];
  if (row.durationSeconds) fields.push({ name: "المدة", value: formatDuration(row.durationSeconds), inline: true });
  fields.push({ name: "السبب", value: row.reason || "بدون سبب" });
  const why = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>).why : null;
  if (typeof why === "string" && why) fields.push({ name: "لماذا؟", value: truncate(why, 1000) });
  return systemixEmbed({
    title: `قضية #${row.caseNumber} · ${label}`,
    tone: destructive ? "danger" : row.type === "warn" ? "warning" : "info",
    fields,
    config,
  });
}
