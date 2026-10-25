import { ChannelType, PermissionFlagsBits, PermissionsBitField, type GuildBasedChannel } from "discord.js";
import type { Express } from "express";
import type { ChannelKind, GuildMeta, ResolvedUser } from "../../../shared/systemix-api";
import * as db from "../../db";
import { getDiscordBotState, getDiscordClient } from "../bot";
import { guildSecurityPatchSchema, mergeGuildSecurityConfig, snowflakeSchema } from "../config";
import { isAssignableRole, isDangerousRole } from "../core/context";
import { discordClientId } from "../oauth";
import { ApiError, guildGet, guildMutation, loadGuildConfig, parseLimit, requireBotGuild } from "./common";
import { acceptsSettingsConfirmation, runWithAuditPrecondition, SETTINGS_CONFIRMATION_HEADER } from "./settings-confirmation";

/** Explicit least-privilege permission set requested by the invite link (never Administrator). */
export const INVITE_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "EmbedLinks",
  "AttachFiles",
  "ReadMessageHistory",
  "AddReactions",
  "UseExternalEmojis",
  "ViewAuditLog",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageMessages",
  "ManageThreads",
  "CreatePrivateThreads",
  "ManageNicknames",
  "ManageWebhooks",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "MoveMembers",
] as const satisfies readonly (keyof typeof PermissionFlagsBits)[];

export function invitePermissionBits(): string {
  return new PermissionsBitField(INVITE_PERMISSIONS.map((name) => PermissionFlagsBits[name])).bitfield.toString();
}

function channelKind(channel: GuildBasedChannel): ChannelKind {
  switch (channel.type) {
    case ChannelType.GuildText: return "text";
    case ChannelType.GuildVoice: return "voice";
    case ChannelType.GuildCategory: return "category";
    case ChannelType.GuildAnnouncement: return "announcement";
    case ChannelType.GuildForum: return "forum";
    case ChannelType.GuildStageVoice: return "stage";
    default: return "other";
  }
}

export function registerCoreApi(app: Express): void {
  guildGet(app, "/invite", async ({ guild }, _req, res) => {
    const params = new URLSearchParams({
      client_id: discordClientId(),
      scope: "bot applications.commands",
      permissions: invitePermissionBits(),
      guild_id: guild.id,
      disable_guild_select: "true",
    });
    res.json({
      url: `https://discord.com/oauth2/authorize?${params.toString()}`,
      permissions: [...INVITE_PERMISSIONS],
      administratorRequested: false,
    });
  });

  guildGet(app, "/meta", async ({ guild: summary }, _req, res) => {
    const guild = requireBotGuild(summary.id);
    const me = guild.members.me ?? await guild.members.fetchMe();
    const channels = [...guild.channels.cache.values()]
      .filter((channel) => !channel.isThread())
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channelKind(channel),
        parentId: channel.parentId ?? null,
        position: "rawPosition" in channel ? channel.rawPosition : 0,
      }))
      .sort((a, b) => a.position - b.position);
    const roles = [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        position: role.position,
        managed: role.managed,
        dangerous: isDangerousRole(role),
        assignable: isAssignableRole(role),
      }));
    const state = getDiscordBotState();
    const meta: GuildMeta = {
      guild: { id: guild.id, name: guild.name, icon: guild.icon, memberCount: guild.memberCount, ownerId: guild.ownerId },
      channels,
      roles,
      bot: { id: me.id, highestRolePosition: me.roles.highest.position, permissions: me.permissions.toArray() },
      intents: { members: state.memberIntentEnabled, messageContent: state.messageContentIntentEnabled },
    };
    res.json(meta);
  });

  guildGet(app, "/users", async ({ guild: summary }, req, res) => {
    const guild = requireBotGuild(summary.id);
    const ids = String(req.query.ids ?? "").split(",").map((value) => value.trim()).filter((value) => snowflakeSchema.safeParse(value).success);
    const unique = [...new Set(ids)].slice(0, 50);
    const users: ResolvedUser[] = [];
    for (const id of unique) {
      const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
      const user = member?.user ?? guild.client.users.cache.get(id) ?? await guild.client.users.fetch(id).catch(() => null);
      if (!user) continue;
      users.push({
        id: user.id,
        username: user.username,
        displayName: member?.displayName ?? user.globalName ?? user.username,
        avatarUrl: (member ?? user).displayAvatarURL({ size: 64 }),
        bot: user.bot,
      });
    }
    res.json({ users });
  });

  guildGet(app, "/settings", async ({ guild: summary }, _req, res) => {
    const settings = await loadGuildConfig(summary.id);
    const subscription = await db.getGuildSubscription(summary.id);
    const botGuild = getDiscordClient()?.guilds.cache.get(summary.id);
    const me = botGuild?.members.me;
    const state = getDiscordBotState();
    res.json({
      settings,
      subscription: subscription
        ? { status: subscription.status, plan: subscription.plan, endsAt: subscription.endsAt }
        : { status: "not_provisioned", plan: null, endsAt: null },
      botInstalled: Boolean(botGuild),
      botOnline: state.status === "ready",
      permissions: {
        viewAuditLog: Boolean(me?.permissions.has(PermissionFlagsBits.ViewAuditLog)),
        manageGuild: Boolean(me?.permissions.has(PermissionFlagsBits.ManageGuild)),
        manageRoles: Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)),
        moderateMembers: Boolean(me?.permissions.has(PermissionFlagsBits.ModerateMembers)),
      },
      memberIntentEnabled: state.memberIntentEnabled,
      messageContentIntentEnabled: state.messageContentIntentEnabled,
    });
  });

  guildMutation(app, "put", "/settings", async ({ guild: summary, session }, req, res) => {
    const parsed = guildSecurityPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_settings", details: parsed.error.issues.slice(0, 20).map((issue) => issue.path.join(".")) });
      return;
    }
    const confirmation = req.get(SETTINGS_CONFIRMATION_HEADER);
    const current = await loadGuildConfig(summary.id);
    const settings = mergeGuildSecurityConfig(current, parsed.data);
    const botState = getDiscordBotState();
    if (parsed.data.antiRaid?.enabled === true && !current.antiRaid.enabled && !botState.memberIntentEnabled) {
      throw new ApiError(409, "guild_members_intent_required");
    }
    if (parsed.data.antiSpam?.enabled === true && !current.antiSpam.enabled && !botState.messageContentIntentEnabled) {
      throw new ApiError(409, "message_content_intent_required");
    }
    if (!acceptsSettingsConfirmation(confirmation, settings.mode)) {
      res.status(428).json({ error: settings.mode === "protect" ? "protect_confirmation_required" : "settings_confirmation_required" });
      return;
    }
    const changedModules = Object.keys(parsed.data);
    const writeResult = await runWithAuditPrecondition(
      () => db.recordSecurityEvent({
        guildId: summary.id,
        eventType: "dashboard:settings_precondition",
        actorId: session.user.id,
        severity: settings.mode === "protect" ? "high" : "medium",
        details: { modules: changedModules, mode: settings.mode, confirmation },
      }),
      () => db.upsertGuildSecuritySettings(summary.id, session.user.id, settings),
    );
    if (!writeResult.ok) {
      res.status(503).json({ error: "audit_precondition_failed" });
      return;
    }
    res.json({ ok: true, settings });
  });

  guildGet(app, "/events", async ({ guild }, req, res) => {
    const limit = parseLimit(req.query.limit, 50, 100);
    const events = await db.listSecurityEvents(guild.id, limit);
    res.json({ events });
  });
}
