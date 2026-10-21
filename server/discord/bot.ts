import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
  type Interaction,
} from "discord.js";
import * as db from "../db";
import { isSystemixAutoModRule } from "./automod";
import { defaultGuildSecurityConfig, normalizeGuildSecurityConfig } from "./config";
import { pushSlidingSample, RollingWriteBudget } from "./limits";
import { discordClientId } from "./oauth";
import { monitoredAuditActionNames, evaluateRaidSignals, matchesDiscordApplicationId, safeDiscordErrorCode } from "./security";

export type DiscordBotState = {
  status: "not_configured" | "disabled_by_policy" | "connecting" | "ready" | "degraded";
  readyAt: string | null;
  guildCount: number;
  memberIntentEnabled: boolean;
  messageContentIntentEnabled: false;
  lastErrorCode: string | null;
};

const runtimeState: DiscordBotState = {
  status: "not_configured",
  readyAt: null,
  guildCount: 0,
  memberIntentEnabled: false,
  messageContentIntentEnabled: false,
  lastErrorCode: null,
};

let client: Client | null = null;
let startPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let initialLoginRetryUsed = false;
let lastTrackingSweepAt = 0;
const MAX_TRACKING_KEYS = 10_000;
const MAX_RAID_JOIN_SAMPLES = 100;
const MAX_EVENT_WRITES_PER_MINUTE = 1_000;
const MAX_HIGH_EVENT_WRITES_PER_MINUTE = 100;
const MAX_ALERTS_PER_MINUTE = 30;
const EVENT_WRITE_INTERVAL_MS = 1_000;
const RAID_EVENT_INTERVAL_MS = 2_000;
const AUTOMOD_EVENT_INTERVAL_MS = 5_000;
const AUTOMOD_RULE_CACHE_TTL_MS = 60_000;
const eventWriteBudget = new RollingWriteBudget(MAX_EVENT_WRITES_PER_MINUTE, 60_000, MAX_HIGH_EVENT_WRITES_PER_MINUTE);
const alertSendBudget = new RollingWriteBudget(MAX_ALERTS_PER_MINUTE);
type ActorWindow = { timestamps: number[]; lastSeenAt: number; lastPersistAt: number; lastAlertAt: number };
const auditActorWindows = new Map<string, ActorWindow>();
const joinTimestamps = new Map<string, number[]>();
const lastRaidAlertAt = new Map<string, number>();
const lastRaidEventAt = new Map<string, number>();
const lastAutoModEventAt = new Map<string, number>();
const autoModRuleCache = new Map<string, { expiresAt: number; ruleIds: Set<string> }>();
const autoModRuleFetches = new Map<string, Promise<Set<string>>>();
const ALERT_COOLDOWN_MS = 30_000;

function setBounded<T>(map: Map<string, T>, key: string, value: T): void {
  if (!map.has(key) && map.size >= MAX_TRACKING_KEYS) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

function sweepTrackingState(now: number): void {
  if (now - lastTrackingSweepAt < 60_000) return;
  lastTrackingSweepAt = now;
  for (const [key, state] of auditActorWindows) {
    if (now - state.lastSeenAt > 10 * 60_000) auditActorWindows.delete(key);
  }
  for (const [key, samples] of joinTimestamps) {
    if (!samples.length || now - samples[samples.length - 1] > 10 * 60_000) joinTimestamps.delete(key);
  }
  for (const [key, timestamp] of lastRaidAlertAt) if (now - timestamp > 10 * 60_000) lastRaidAlertAt.delete(key);
  for (const [key, timestamp] of lastRaidEventAt) if (now - timestamp > 10 * 60_000) lastRaidEventAt.delete(key);
  for (const [key, timestamp] of lastAutoModEventAt) if (now - timestamp > 10 * 60_000) lastAutoModEventAt.delete(key);
  for (const [key, cache] of autoModRuleCache) if (cache.expiresAt <= now) autoModRuleCache.delete(key);
}

function allowSecurityEventWrite(severity: "low" | "medium" | "high"): boolean {
  return eventWriteBudget.tryConsume(severity === "high");
}

function allowAlertSend(): boolean {
  return alertSendBudget.tryConsume();
}

const systemixCommand = new SlashCommandBuilder()
  .setName("systemix")
  .setDescription("حالة حماية Security Systemix")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((command) => command.setName("status").setDescription("اعرض حالة الحماية لهذا السيرفر"))
  .addSubcommand((command) => command.setName("simulate").setDescription("اعرض شرحاً تجريبياً دون تغيير Discord"));

export function getDiscordClient(): Client | null {
  return client;
}

export function getDiscordBotState(): DiscordBotState {
  return {
    ...runtimeState,
    guildCount: client?.guilds.cache.size ?? runtimeState.guildCount,
  };
}

function logSafe(message: string, error?: unknown): void {
  const code = error ? safeDiscordErrorCode(error) : "";
  console.warn(`[Discord] ${message}${code ? ` (${code})` : ""}`);
}

async function registerSystemixCommand(): Promise<void> {
  const application = client?.application;
  if (!application) return;
  try {
    const commands = await application.commands.fetch();
    const existing = commands.find((command) => command.name === "systemix");
    if (existing) await existing.edit(systemixCommand);
    else await application.commands.create(systemixCommand);
  } catch (error) {
    runtimeState.lastErrorCode = safeDiscordErrorCode(error);
    logSafe("Slash command registration failed", error);
  }
}

async function replyToCommand(interaction: Interaction): Promise<void> {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "systemix" || !interaction.guildId) return;
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "simulate") {
    await interaction.reply({
      ephemeral: true,
      content: "هذه محاكاة فقط: لم تُرسل عقوبة أو قفل إلى Discord. فعّل قواعد كل سيرفر بعد مراجعتها من لوحة Systemix.",
    });
    return;
  }
  let config = defaultGuildSecurityConfig;
  try {
    const row = await db.getGuildSecuritySettings(interaction.guildId);
    config = normalizeGuildSecurityConfig(row?.settings);
  } catch (error) {
    logSafe(`Could not read settings for guild ${interaction.guildId}`, error);
  }
  const state = getDiscordBotState();
  const active = [
    config.antiNuke.enabled ? "Anti-Nuke (تنبيه فقط)" : null,
    config.antiRaid.enabled ? "Anti-Raid (إشارات للمراجعة)" : null,
    config.autoMod.enabled ? "AutoMod (يتطلب تطبيقاً صريحاً)" : null,
  ].filter(Boolean);
  await interaction.reply({
    ephemeral: true,
    content: [
      "**Security Systemix — حالة السيرفر**",
      `الاتصال: ${state.status === "ready" ? "متصل" : "غير جاهز"}`,
      `الوضع: ${config.mode === "observe" ? "مراقبة وتنبيه فقط" : "مقيّد"}`,
      `الوحدات المسجلة: ${active.length ? active.join("، ") : "لا توجد قواعد مفعّلة"}`,
      `Intent أعضاء السيرفر: ${state.memberIntentEnabled ? "مفعّل" : "غير مفعّل؛ رصد الانضمام غير متاح"}`,
      "لا تُنفذ عقوبات تلقائية بواسطة هذا الأمر.",
    ].join("\n"),
  });
}

async function sendGuildAlert(guild: Guild, channelId: string | null, content: string): Promise<void> {
  if (!channelId || !allowAlertSend()) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel) || typeof channel.send !== "function") return;
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    logSafe(`Alert could not be sent in guild ${guild.id}`, error);
  }
}

async function monitorAuditEntry(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
  const actionName = monitoredAuditActionNames.get(entry.action);
  if (!actionName || !entry.executorId || entry.executorId === client?.user?.id) return;
  try {
    const row = await db.getGuildSecuritySettings(guild.id);
    if (!row) return;
    const config = normalizeGuildSecurityConfig(row.settings);
    if (!config.antiNuke.enabled || config.antiNuke.allowlistedActorIds.includes(entry.executorId)) return;

    const now = Date.now();
    sweepTrackingState(now);
    const actorKey = `${guild.id}:${entry.executorId}`;
    const current = auditActorWindows.get(actorKey) ?? {
      timestamps: [],
      lastSeenAt: now,
      lastPersistAt: 0,
      lastAlertAt: 0,
    };
    const windowMs = config.antiNuke.windowSeconds * 1000;
    const maxSamples = Math.max(2, Math.min(100, config.antiNuke.threshold));
    current.timestamps = pushSlidingSample(current.timestamps, now, windowMs, maxSamples);
    current.lastSeenAt = now;
    setBounded(auditActorWindows, actorKey, current);
    const count = current.timestamps.length;

    if (now - current.lastPersistAt >= EVENT_WRITE_INTERVAL_MS && allowSecurityEventWrite("medium")) {
      current.lastPersistAt = now;
      await db.recordSecurityEvent({
        guildId: guild.id,
        eventType: `anti_nuke:${actionName}`,
        actorId: entry.executorId,
        targetId: entry.targetId ?? null,
        severity: "medium",
        details: { action: actionName, auditEntryId: entry.id, observedAt: new Date(now).toISOString(), observedActions: count },
      });
    }

    if (count < config.antiNuke.threshold || now - current.lastAlertAt < ALERT_COOLDOWN_MS) return;
    current.lastAlertAt = now;
    if (allowSecurityEventWrite("high")) {
      await db.recordSecurityEvent({
        guildId: guild.id,
        eventType: "anti_nuke:threshold_alert",
        actorId: entry.executorId,
        targetId: entry.targetId ?? null,
        severity: "high",
        details: { observedActions: count, threshold: config.antiNuke.threshold, windowSeconds: config.antiNuke.windowSeconds },
      });
    }
    await sendGuildAlert(
      guild,
      config.antiNuke.alertChannelId,
      `تنبيه Systemix: رُصدت ${count} تغييرات إدارية حساسة خلال ${config.antiNuke.windowSeconds} ثوانٍ بواسطة عضو واحد. تم تسجيل الإشارة فقط؛ لم يُنفذ حظر أو قفل تلقائي.`,
    );
  } catch (error) {
    runtimeState.status = "degraded";
    runtimeState.lastErrorCode = safeDiscordErrorCode(error);
    logSafe(`Audit monitor degraded for guild ${guild.id}`, error);
  }
}

async function monitorMemberJoin(member: GuildMember): Promise<void> {
  try {
    const row = await db.getGuildSecuritySettings(member.guild.id);
    if (!row) return;
    const config = normalizeGuildSecurityConfig(row.settings);
    if (!config.antiRaid.enabled) return;

    const now = Date.now();
    sweepTrackingState(now);
    const key = member.guild.id;
    const maxSamples = Math.max(2, Math.min(MAX_RAID_JOIN_SAMPLES, config.antiRaid.joinThreshold));
    const recent = pushSlidingSample(
      joinTimestamps.get(key) ?? [],
      now,
      config.antiRaid.windowSeconds * 1000,
      maxSamples,
    );
    setBounded(joinTimestamps, key, recent);
    const signals = evaluateRaidSignals({
      accountAgeMs: Math.max(0, now - member.user.createdTimestamp),
      accountAgeThresholdMs: config.antiRaid.minAccountAgeHours * 60 * 60 * 1000,
      joinsInWindow: recent.length,
      joinThreshold: config.antiRaid.joinThreshold,
    });
    if (!signals.suspicious) return;

    const severity = signals.signals.includes("join_burst") ? "high" : "medium";
    const previousEvent = lastRaidEventAt.get(key) ?? 0;
    if (now - previousEvent >= RAID_EVENT_INTERVAL_MS && allowSecurityEventWrite(severity)) {
      setBounded(lastRaidEventAt, key, now);
      await db.recordSecurityEvent({
        guildId: member.guild.id,
        eventType: "anti_raid:risk_signal",
        actorId: member.id,
        targetId: member.id,
        severity,
        details: {
          signals: signals.signals,
          accountAgeHours: Math.floor(Math.max(0, now - member.user.createdTimestamp) / 3_600_000),
          joinsInWindow: recent.length,
          windowSeconds: config.antiRaid.windowSeconds,
          logCoalescingSeconds: RAID_EVENT_INTERVAL_MS / 1000,
        },
      });
    }

    const previousAlert = lastRaidAlertAt.get(key) ?? 0;
    if (now - previousAlert >= ALERT_COOLDOWN_MS) {
      setBounded(lastRaidAlertAt, key, now);
      await sendGuildAlert(
        member.guild,
        config.antiRaid.alertChannelId,
        `إشارة Anti-Raid للمراجعة: ${recent.length} انضمامات خلال ${config.antiRaid.windowSeconds} ثوانٍ. الحسابات الحديثة إشارة مساعدة وليست دليلاً منفرداً. لم يُطرد أو يُحظر أي عضو.`,
      );
    }
  } catch (error) {
    runtimeState.status = "degraded";
    runtimeState.lastErrorCode = safeDiscordErrorCode(error);
    logSafe(`Raid monitor degraded for guild ${member.guild.id}`, error);
  }
}

async function getSystemixAutoModRuleIds(guild: Guild): Promise<Set<string>> {
  const now = Date.now();
  const cached = autoModRuleCache.get(guild.id);
  if (cached && cached.expiresAt > now) return cached.ruleIds;
  const inFlight = autoModRuleFetches.get(guild.id);
  if (inFlight) return inFlight;
  const botId = client?.user?.id;
  if (!botId) return new Set();

  const pending = (async () => {
    const rules = await guild.autoModerationRules.fetch();
    const ruleIds = new Set<string>();
    for (const rule of rules.values()) {
      if (isSystemixAutoModRule(rule, botId)) ruleIds.add(rule.id);
    }
    setBounded(autoModRuleCache, guild.id, { expiresAt: Date.now() + AUTOMOD_RULE_CACHE_TTL_MS, ruleIds });
    return ruleIds;
  })();
  setBounded(autoModRuleFetches, guild.id, pending);
  try {
    return await pending;
  } finally {
    if (autoModRuleFetches.get(guild.id) === pending) autoModRuleFetches.delete(guild.id);
  }
}

async function handleAutoModerationExecution(execution: { guild: Guild; userId: string; ruleId: string; channelId: string | null; action: { type: number } }): Promise<void> {
  try {
    const row = await db.getGuildSecuritySettings(execution.guild.id);
    if (!row) return;
    const config = normalizeGuildSecurityConfig(row.settings);
    if (!config.autoMod.enabled) return;
    const ownedRuleIds = await getSystemixAutoModRuleIds(execution.guild);
    if (!ownedRuleIds.has(execution.ruleId)) return;
    const now = Date.now();
    const key = `${execution.guild.id}:${execution.ruleId}`;
    if (now - (lastAutoModEventAt.get(key) ?? 0) < AUTOMOD_EVENT_INTERVAL_MS) return;
    if (!allowSecurityEventWrite("low")) return;
    setBounded(lastAutoModEventAt, key, now);
    await db.recordSecurityEvent({
      guildId: execution.guild.id,
      eventType: "auto_mod:action",
      actorId: execution.userId,
      targetId: execution.userId,
      severity: "low",
      details: {
        ruleId: execution.ruleId,
        actionType: execution.action.type,
        channelId: execution.channelId,
      },
    });
    // Discord's native SendAlertMessage action handles notifications; don't send a duplicate.
  } catch (error) {
    logSafe(`AutoMod event recording failed for guild ${execution.guild.id}`, error);
  }
}

export async function startDiscordBot(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) {
      runtimeState.status = "not_configured";
      return;
    }
    if (process.env.NODE_ENV === "production" && process.env.SYSTEMIX_ENABLE_PRODUCTION_GATEWAY !== "true") {
      runtimeState.status = "disabled_by_policy";
      return;
    }

    const memberIntentEnabled = process.env.SYSTEMIX_ENABLE_GUILD_MEMBERS_INTENT === "true";
    runtimeState.status = "connecting";
    runtimeState.memberIntentEnabled = memberIntentEnabled;
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration];
    if (memberIntentEnabled) intents.push(GatewayIntentBits.GuildMembers);

    const bot = new Client({ intents });
    client = bot;
    bot.once(Events.ClientReady, (readyClient) => {
      if (!matchesDiscordApplicationId(discordClientId(), readyClient.user.id)) {
        runtimeState.status = "degraded";
        runtimeState.readyAt = null;
        runtimeState.guildCount = 0;
        runtimeState.lastErrorCode = "bot_application_id_mismatch";
        logSafe("Bot identity does not match the configured Discord application ID");
        bot.destroy();
        if (client === bot) client = null;
        return;
      }
      runtimeState.status = "ready";
      runtimeState.readyAt = new Date().toISOString();
      runtimeState.guildCount = readyClient.guilds.cache.size;
      runtimeState.lastErrorCode = null;
      initialLoginRetryUsed = false;
      void registerSystemixCommand();
      console.info(`[Discord] Gateway ready for ${runtimeState.guildCount} guild(s)`);
    });
    bot.on(Events.GuildCreate, () => {
      runtimeState.guildCount = bot.guilds.cache.size;
    });
    bot.on(Events.GuildDelete, () => {
      runtimeState.guildCount = bot.guilds.cache.size;
    });
    bot.on(Events.ShardDisconnect, () => {
      if (runtimeState.status === "ready") runtimeState.status = "connecting";
    });
    bot.on(Events.ShardReconnecting, () => {
      if (runtimeState.status !== "degraded") runtimeState.status = "connecting";
    });
    bot.on(Events.ShardResume, () => {
      runtimeState.status = "ready";
      runtimeState.readyAt ??= new Date().toISOString();
      runtimeState.guildCount = bot.guilds.cache.size;
      runtimeState.lastErrorCode = null;
    });
    bot.on(Events.Invalidated, () => {
      runtimeState.status = "degraded";
      runtimeState.lastErrorCode = "session_invalidated";
    });
    bot.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
      void monitorAuditEntry(entry, guild);
    });
    bot.on(Events.AutoModerationActionExecution, (execution) => {
      void handleAutoModerationExecution(execution);
    });
    if (memberIntentEnabled) bot.on(Events.GuildMemberAdd, (member) => void monitorMemberJoin(member));
    bot.on(Events.InteractionCreate, (interaction) => {
      void replyToCommand(interaction).catch((error) => logSafe("Slash command failed", error));
    });
    bot.on(Events.Error, (error) => {
      runtimeState.status = "degraded";
      runtimeState.lastErrorCode = safeDiscordErrorCode(error);
      logSafe("Gateway error", error);
    });

    try {
      await bot.login(token);
    } catch (error) {
      const errorCode = safeDiscordErrorCode(error);
      runtimeState.status = "degraded";
      runtimeState.lastErrorCode = errorCode;
      logSafe("Gateway login failed", error);
      bot.destroy();
      client = null;
      startPromise = null;
      const permanentFailure = ["discord_http_401", "discord_http_403", "tokeninvalid", "disallowedintents", "privilegedintentsrequired"].includes(errorCode);
      if (!permanentFailure && !initialLoginRetryUsed && !retryTimer) {
        initialLoginRetryUsed = true;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void startDiscordBot();
        }, 5_000);
        retryTimer.unref?.();
      }
    }
  })();
  return startPromise;
}

export async function stopDiscordBot(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (client) {
    client.destroy();
    client = null;
  }
  runtimeState.status = process.env.DISCORD_BOT_TOKEN ? "disabled_by_policy" : "not_configured";
  runtimeState.readyAt = null;
  runtimeState.guildCount = 0;
  startPromise = null;
}
