import { PermissionFlagsBits, type GuildMember, type MessageCreateOptions, type PartialGuildMember } from "discord.js";
import type { SystemixModule } from "../core/types";
import { dmMember, getGuildConfig, isSafeGrantRole, recordEvent, sendToChannel, systemixEmbed } from "../core/context";

/** Limited placeholder renderer: disarm Discord markup and recognize only documented variables. */
export function renderWelcomeTemplate(template: string, vars: { userId: string; server: string; memberCount: number }): { content: string; mentionsUser: boolean } {
  let mentionsUser = false;
  const escaped = template
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~|])/g, "\\$1")
    .replace(/</g, "‹").replace(/>/g, "›");
  const content = escaped.replace(/\{(user|server|memberCount|count)\}/g, (_match, key: string) => {
    if (key === "user") { mentionsUser = true; return `<@${vars.userId}>`; }
    return key === "server" ? vars.server.slice(0, 100) : String(vars.memberCount);
  }).slice(0, 2000);
  return { content, mentionsUser };
}

/** An image URL forces an Embed so Discord can render it below the welcome message. */
export function welcomePayload(member: GuildMember, template: string, useEmbed: boolean, imageUrl: string | null): MessageCreateOptions {
  const rendered = renderWelcomeTemplate(template, { userId: member.id, server: member.guild.name, memberCount: member.guild.memberCount });
  const allowedMentions = rendered.mentionsUser ? { users: [member.id], parse: [] as never[] } : { parse: [] as never[] };
  if (useEmbed || imageUrl) return { embeds: [systemixEmbed({ description: rendered.content, image: imageUrl })], allowedMentions };
  return { content: rendered.content, allowedMentions };
}

async function onMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const guild = member.guild;
  const config = await getGuildConfig(guild.id);
  const settings = config.welcome;
  if (!settings.enabled) return;

  const auditSaved = await recordEvent({ guildId: guild.id, eventType: "welcome:member_join", actorId: null, targetId: member.id, severity: "low", details: { memberCount: guild.memberCount } });
  if (!auditSaved) return;

  if (settings.channelId) await sendToChannel(guild, settings.channelId, welcomePayload(member, settings.message, settings.useEmbed, settings.imageUrl));
  if (settings.dmEnabled) await dmMember(member, welcomePayload(member, settings.dmMessage, false, null));

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
  for (const roleId of settings.autoRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.guild.id !== guild.id || !isSafeGrantRole(role)) continue;
    // Safe role guard checks bot role order and ManageRoles; ensure this is a grantable member target too.
    if (member.id === guild.ownerId || member.roles.highest.comparePositionTo(me.roles.highest) >= 0) continue;
    if (member.roles.cache.has(role.id)) continue;
    const roleAuditSaved = await recordEvent({ guildId: guild.id, eventType: "welcome:auto_role_attempt", actorId: me.id, targetId: member.id, severity: "low", details: { roleId: role.id } });
    if (!roleAuditSaved) continue;
    try { await member.roles.add(role, "Security Systemix welcome auto-role"); }
    catch { /* Discord may reject assignment due to hierarchy/permission changes; do not log message content. */ }
  }
}

async function onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  if (!member.user || member.user.bot) return;
  const guild = member.guild;
  const config = await getGuildConfig(guild.id);
  const settings = config.welcome;
  if (!settings.enabled || !settings.goodbyeEnabled || !settings.goodbyeChannelId) return;
  const auditSaved = await recordEvent({ guildId: guild.id, eventType: "welcome:member_leave", actorId: null, targetId: member.id, severity: "low", details: { memberCount: guild.memberCount } });
  if (!auditSaved) return;
  const rendered = renderWelcomeTemplate(settings.goodbyeMessage, { userId: member.id, server: guild.name, memberCount: guild.memberCount });
  await sendToChannel(guild, settings.goodbyeChannelId, { content: rendered.content, allowedMentions: { parse: [] } });
}

export const welcomeModule: SystemixModule = { name: "welcome", implemented: true, onMemberAdd, onMemberRemove };
