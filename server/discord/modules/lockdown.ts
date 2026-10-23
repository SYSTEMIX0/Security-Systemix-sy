import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type MessageCreateOptions,
  type PermissionOverwriteManager,
} from "discord.js";
import type { GuildSecurityConfig } from "../config";
import {
  enforcementEnabled,
  getGuildConfig,
  isStaffMember,
  logSafe,
  recordEvent,
  replyEphemeral,
  sendSecurityAlert,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import {
  getLockdownState as readLockdownState,
  listActiveLockdownStates,
  saveLockdownState,
  type LockdownTrigger,
  type PreviousSendMessages,
  type SavedLockdownChannel,
} from "../store/lockdown";

const MAX_DURATION_MINUTES = 1_440;
const inFlight = new Set<string>();
const THREAD_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);
type LockableChannel = GuildBasedChannel & { permissionOverwrites: PermissionOverwriteManager };

function hasPermissionOverwrites(channel: GuildBasedChannel): channel is LockableChannel {
  return "permissionOverwrites" in channel;
}

export type LockdownOperationResult = {
  ok: boolean;
  channelsChanged: number;
  active: boolean;
  endsAt: string | null;
  error?: string;
};

export function previousSendMessagesState(allow: boolean, deny: boolean): PreviousSendMessages {
  if (allow) return "allow";
  if (deny) return "deny";
  return "neutral";
}

export function restoredSendMessagesValue(previous: PreviousSendMessages): boolean | null {
  if (previous === "allow") return true;
  if (previous === "deny") return false;
  return null;
}

function lockableChannels(guild: Guild, config: GuildSecurityConfig): LockableChannel[] {
  const excluded = new Set([
    ...config.lockdown.exemptChannelIds,
    config.general.securityLogChannelId,
    config.general.modLogChannelId,
  ].filter((id): id is string => Boolean(id)));
  return [...guild.channels.cache.values()].filter((channel): channel is LockableChannel =>
    channel.isTextBased()
    && !THREAD_TYPES.has(channel.type)
    && hasPermissionOverwrites(channel)
    && !excluded.has(channel.id),
  );
}

export function buildLockdownPlan(guild: Guild, config: GuildSecurityConfig) {
  const me = guild.members.me;
  const channels = lockableChannels(guild, config);
  const permissionReady = Boolean(me?.permissions.has(PermissionFlagsBits.ManageChannels));
  return {
    active: false,
    canLock: permissionReady && channels.length > 0,
    permissionReady,
    lockableCount: channels.length,
    exemptChannelIds: [...new Set([
      ...config.lockdown.exemptChannelIds,
      config.general.securityLogChannelId,
      config.general.modLogChannelId,
    ].filter((id): id is string => Boolean(id)))],
    channels: channels.slice(0, 200).map((channel) => ({ id: channel.id, name: channel.name, type: channel.type })),
  };
}

export async function getCurrentLockdownState(guildId: string) {
  const row = await readLockdownState(guildId);
  return row ? {
    active: row.active,
    reason: row.reason,
    startedById: row.startedById,
    trigger: row.trigger,
    channelCount: row.channels.length,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  } : {
    active: false,
    reason: null,
    startedById: null,
    trigger: null,
    channelCount: 0,
    startedAt: null,
    endsAt: null,
  };
}

function cleanReason(reason: string): string {
  return reason.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512) || "Security lockdown";
}

function isAuthorizedAutomaticTrigger(trigger: LockdownTrigger, config: GuildSecurityConfig): boolean {
  if (trigger === "anti_nuke") return enforcementEnabled(config) && config.antiNuke.enabled && config.antiNuke.lockdownOnTrigger;
  if (trigger === "anti_raid") return enforcementEnabled(config) && config.antiRaid.enabled && config.antiRaid.autoLockdown;
  return true;
}

function alertPayload(title: string, reason: string, count: number): MessageCreateOptions {
  return {
    embeds: [systemixEmbed({
      title,
      tone: "warning",
      fields: [
        { name: "السبب", value: reason.slice(0, 1_000) },
        { name: "القنوات المتأثرة", value: String(count), inline: true },
      ],
    })],
    allowedMentions: { parse: [] },
  };
}

export async function activateLockdown(
  guild: Guild,
  config: GuildSecurityConfig,
  input: { actorId: string | null; reason: string; trigger: LockdownTrigger; durationMinutes?: number },
): Promise<LockdownOperationResult> {
  if (!isAuthorizedAutomaticTrigger(input.trigger, config)) {
    return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: "automatic_lockdown_not_authorized" };
  }
  if (inFlight.has(guild.id)) return { ok: false, channelsChanged: 0, active: true, endsAt: null, error: "lockdown_operation_in_progress" };
  inFlight.add(guild.id);
  try {
    const existing = await readLockdownState(guild.id);
    if (existing?.active) {
      return { ok: true, channelsChanged: 0, active: true, endsAt: existing.endsAt?.toISOString() ?? null };
    }
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: "bot_missing_manage_channels" };
    }
    const candidates = lockableChannels(guild, config);
    if (!candidates.length) return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: "no_lockable_channels" };

    const snapshot: SavedLockdownChannel[] = candidates.map((channel) => {
      const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      return {
        channelId: channel.id,
        previous: previousSendMessagesState(
          Boolean(overwrite?.allow.has(PermissionFlagsBits.SendMessages)),
          Boolean(overwrite?.deny.has(PermissionFlagsBits.SendMessages)),
        ),
      };
    });
    const now = new Date();
    const requestedDuration = input.durationMinutes;
    const duration = Number.isInteger(requestedDuration) && requestedDuration! > 0
      ? Math.min(MAX_DURATION_MINUTES, requestedDuration!)
      : input.trigger === "manual" || input.trigger === "dashboard" ? null : 10;
    const endsAt = duration ? new Date(now.getTime() + duration * 60_000) : null;
    const reason = cleanReason(input.reason);

    const attemptSaved = await recordEvent({
      guildId: guild.id, eventType: "lockdown_start_attempt", actorId: input.actorId,
      severity: "high", details: { trigger: input.trigger, plannedChannels: snapshot.length, reason },
    });
    if (!attemptSaved) return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: "audit_unavailable" };

    // Persist the exact pre-state before changing any channel, so a restart can still unlock safely.
    await saveLockdownState({
      guildId: guild.id,
      active: true,
      reason,
      startedById: input.actorId,
      trigger: input.trigger,
      channels: snapshot,
      startedAt: now,
      endsAt,
    });

    let changed = 0;
    let failed = 0;
    for (const channel of candidates) {
      const channelPerms = channel.permissionsFor(me);
      if (!channelPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
        failed += 1;
        continue;
      }
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason });
        changed += 1;
      } catch (error) {
        failed += 1;
        logSafe(`Lockdown channel update failed in guild ${guild.id}`, error);
      }
    }

    if (changed === 0) {
      await saveLockdownState({
        guildId: guild.id, active: false, reason, startedById: input.actorId,
        trigger: input.trigger, channels: [], startedAt: null, endsAt: null,
      });
      await recordEvent({
        guildId: guild.id, eventType: "lockdown_start_result", actorId: input.actorId,
        severity: "high", details: { trigger: input.trigger, changed: 0, failed, result: "no_channels_locked" },
      });
      return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: failed ? "no_channels_locked" : "no_lockable_channels" };
    }

    await recordEvent({
      guildId: guild.id,
      eventType: "lockdown_start_result",
      actorId: input.actorId,
      severity: input.trigger === "manual" || input.trigger === "dashboard" ? "medium" : "high",
      details: { trigger: input.trigger, channelsChanged: changed, channelsFailed: failed, reason, result: failed ? "partial" : "active" },
    });
    if (config.lockdown.announce) {
      await sendSecurityAlert(guild, config, config.general.securityLogChannelId, alertPayload("تم تفعيل قفل الحماية", reason, changed));
    }
    return { ok: failed === 0, channelsChanged: changed, active: true, endsAt: endsAt?.toISOString() ?? null, ...(failed ? { error: "some_channels_could_not_be_locked" } : {}) };
  } catch (error) {
    logSafe(`Lockdown activation failed in guild ${guild.id}`, error);
    return { ok: false, channelsChanged: 0, active: false, endsAt: null, error: "lockdown_storage_or_discord_error" };
  } finally {
    inFlight.delete(guild.id);
  }
}

export async function deactivateLockdown(
  guild: Guild,
  input: { actorId: string | null; reason: string },
): Promise<{ ok: boolean; channelsRestored: number; active: boolean; error?: string }> {
  if (inFlight.has(guild.id)) return { ok: false, channelsRestored: 0, active: true, error: "lockdown_operation_in_progress" };
  inFlight.add(guild.id);
  try {
    const state = await readLockdownState(guild.id);
    if (!state?.active) return { ok: true, channelsRestored: 0, active: false };
    if (input.actorId) {
      const attemptSaved = await recordEvent({
        guildId: guild.id, eventType: "lockdown_end_attempt", actorId: input.actorId,
        severity: "high", details: { channels: state.channels.length, reason: cleanReason(input.reason) },
      });
      if (!attemptSaved) return { ok: false, channelsRestored: 0, active: true, error: "audit_unavailable" };
    }
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { ok: false, channelsRestored: 0, active: true, error: "bot_missing_manage_channels" };
    }
    let restored = 0;
    let failed = 0;
    for (const saved of state.channels) {
      const channel = guild.channels.cache.get(saved.channelId);
      if (!channel || !("permissionOverwrites" in channel)) {
        // A deleted channel no longer needs its old overwrite restored.
        restored += 1;
        continue;
      }
      const perms = channel.permissionsFor(me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
        failed += 1;
        continue;
      }
      try {
        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          { SendMessages: restoredSendMessagesValue(saved.previous) },
          { reason: cleanReason(input.reason) },
        );
        restored += 1;
      } catch (error) {
        failed += 1;
        logSafe(`Lockdown restore failed in guild ${guild.id}`, error);
      }
    }
    if (failed === 0) {
      await saveLockdownState({
        guildId: guild.id,
        active: false,
        reason: cleanReason(input.reason),
        startedById: input.actorId,
        trigger: "manual",
        channels: [],
        startedAt: null,
        endsAt: null,
      });
      await recordEvent({
        guildId: guild.id,
        eventType: "lockdown_ended",
        actorId: input.actorId,
        severity: "medium",
        details: { channelsRestored: restored },
      });
      return { ok: true, channelsRestored: restored, active: false };
    }
    return { ok: false, channelsRestored: restored, active: true, error: "some_channels_could_not_be_restored" };
  } catch (error) {
    logSafe(`Lockdown deactivation failed in guild ${guild.id}`, error);
    return { ok: false, channelsRestored: 0, active: true, error: "lockdown_storage_or_discord_error" };
  } finally {
    inFlight.delete(guild.id);
  }
}

async function runExpiredLockdowns(guilds: Iterable<Guild>): Promise<void> {
  const now = Date.now();
  for (const guild of guilds) {
    try {
      const state = await readLockdownState(guild.id);
      if (state?.active && state.endsAt && state.endsAt.getTime() <= now) {
        await deactivateLockdown(guild, { actorId: null, reason: "انتهت مدة القفل المحددة" });
      }
    } catch (error) {
      logSafe(`Lockdown expiry check failed in guild ${guild.id}`, error);
    }
  }
}

const command = new SlashCommandBuilder()
  .setName("lockdown")
  .setDescription("إدارة قفل الحماية المؤقت")
  .addSubcommand((sub) => sub.setName("start").setDescription("قفل إرسال الرسائل مؤقتاً")
    .addStringOption((option) => option.setName("reason").setDescription("سبب القفل").setMaxLength(300).setRequired(true))
    .addIntegerOption((option) => option.setName("minutes").setDescription("مدة القفل بالدقائق (اختياري)").setMinValue(1).setMaxValue(MAX_DURATION_MINUTES)))
  .addSubcommand((sub) => sub.setName("end").setDescription("استعادة حالة الإرسال السابقة"));

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const member = interaction.member as GuildMember;
  const config = await getGuildConfig(interaction.guildId);
  if (!isStaffMember(member, config)) {
    await replyEphemeral(interaction, "هذا الأمر مخصص لمالك السيرفر أو فريق الإشراف المصرح.");
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "start") {
    const reason = interaction.options.getString("reason", true);
    const durationMinutes = interaction.options.getInteger("minutes");
    const result = await activateLockdown(interaction.guild, config, {
      actorId: interaction.user.id,
      reason,
      trigger: "manual",
      ...(durationMinutes ? { durationMinutes } : {}),
    });
    await replyEphemeral(interaction, result.ok
      ? `تم تفعيل القفل في ${result.channelsChanged} قناة${result.endsAt ? ` حتى ${result.endsAt}` : " بلا انتهاء تلقائي"}.`
      : `لم يكتمل القفل: ${result.error ?? "تعذر التنفيذ"}${result.active ? "؛ الحالة محفوظة ويمكن استعادتها" : ""}.`);
    return;
  }
  const result = await deactivateLockdown(interaction.guild, { actorId: interaction.user.id, reason: "إنهاء يدوي للقفل" });
  await replyEphemeral(interaction, result.ok
    ? `تمت استعادة الحالة السابقة في ${result.channelsRestored} قناة.`
    : `تعذرت استعادة بعض القنوات؛ سيظل القفل مسجلاً فعالاً حتى إصلاح الصلاحيات (${result.error}).`);
}

export const lockdownModule: SystemixModule = {
  name: "lockdown",
  implemented: true,
  commands: [command.toJSON()],
  onCommand,
  onReady: async (client) => runExpiredLockdowns(client.guilds.cache.values()),
  intervals: [{ name: "expire-lockdowns", everyMs: 30_000, run: async (client) => runExpiredLockdowns(client.guilds.cache.values()) }],
};

export type { LockdownTrigger };
