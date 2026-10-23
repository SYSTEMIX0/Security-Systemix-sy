import { PermissionFlagsBits, type Guild, type GuildMember, type MessageCreateOptions } from "discord.js";
import type { GuildSecurityConfig } from "../config";
import {
  actorOutranks,
  enforcementEnabled,
  getGuildConfig,
  logSafe,
  recordCase,
  recordEvent,
  sendSecurityAlert,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { pushSlidingSample } from "../limits";
import { evaluateRaidSignals } from "../security";
import { setCaseActive, updateCaseReason } from "../store/cases";
import { activateLockdown } from "./lockdown";

const MAX_GUILD_WINDOWS = 5_000;
type RaidWindow = { joins: number[]; raidUntil: number };
const raidWindows = new Map<string, RaidWindow>();

export function advanceJoinWindow(previous: RaidWindow, now: number, windowMs: number, threshold: number) {
  const joins = pushSlidingSample(previous.joins, now, windowMs, Math.max(threshold * 3, 100));
  const started = joins.length >= threshold && previous.raidUntil <= now;
  return {
    state: { joins, raidUntil: started ? now + windowMs : previous.raidUntil },
    count: joins.length,
    started,
    active: started || previous.raidUntil > now,
  };
}

function pruneRaidWindows(now: number): void {
  if (raidWindows.size <= MAX_GUILD_WINDOWS) return;
  for (const [guildId, state] of raidWindows) {
    const lastJoin = state.joins.at(-1) ?? 0;
    if (now - lastJoin > 60 * 60_000 && state.raidUntil <= now) raidWindows.delete(guildId);
    if (raidWindows.size <= MAX_GUILD_WINDOWS) return;
  }
  while (raidWindows.size > MAX_GUILD_WINDOWS) {
    const oldest = raidWindows.keys().next().value;
    if (!oldest) break;
    raidWindows.delete(oldest);
  }
}

function alertPayload(member: GuildMember, ageHours: number, signals: string[], joins: number, config: GuildSecurityConfig): MessageCreateOptions {
  return {
    embeds: [systemixEmbed({
      title: signals.includes("join_burst") ? "تم رصد موجة انضمام" : "إشارة عضو جديد للمراجعة",
      tone: signals.includes("join_burst") ? "danger" : "warning",
      description: "الإشارات تساعد على الفرز ولا تثبت وحدها نية ضارة. الوضع الحالي لا يعاقب تلقائياً إلا إذا اختار المالك وضع الحماية.",
      fields: [
        { name: "العضو", value: `\`${member.id}\``, inline: true },
        { name: "عمر الحساب التقريبي", value: `${Math.max(0, Math.floor(ageHours))} ساعة`, inline: true },
        { name: "الانضمامات في النافذة", value: String(joins), inline: true },
        { name: "الإشارات", value: signals.join("، ") || "—" },
      ],
      config,
    })],
    allowedMentions: { parse: [] },
  };
}

async function applyRaidAction(
  member: GuildMember,
  action: "alert" | "timeout" | "kick" | "ban",
  config: GuildSecurityConfig,
  reason: string,
): Promise<{ applied: boolean; result: string }> {
  if (action === "alert") return { applied: false, result: "alert_only" };
  const me = member.guild.members.me;
  if (!me || member.id === member.guild.ownerId || !actorOutranks(me, member)) return { applied: false, result: "hierarchy_guard" };
  try {
    if (action === "timeout") {
      if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return { applied: false, result: "missing_moderate_members" };
      await member.timeout(config.antiRaid.timeoutMinutes * 60_000, reason);
    } else if (action === "kick") {
      if (!me.permissions.has(PermissionFlagsBits.KickMembers)) return { applied: false, result: "missing_kick_members" };
      await member.kick(reason);
    } else {
      if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return { applied: false, result: "missing_ban_members" };
      await member.ban({ reason });
    }
    return { applied: true, result: action };
  } catch (error) {
    logSafe(`Anti-Raid action failed for guild ${member.guild.id}`, error);
    return { applied: false, result: "discord_action_failed" };
  }
}

async function onMemberAdd(member: GuildMember): Promise<void> {
  const guild = member.guild;
  const config = await getGuildConfig(guild.id);
  if (!config.antiRaid.enabled || member.id === guild.client.user.id) return;
  const now = Date.now();
  pruneRaidWindows(now);
  const previous = raidWindows.get(guild.id) ?? { joins: [], raidUntil: 0 };
  const window = advanceJoinWindow(previous, now, config.antiRaid.windowSeconds * 1_000, config.antiRaid.joinThreshold);
  raidWindows.set(guild.id, window.state);

  const ageMs = Math.max(0, now - member.user.createdTimestamp);
  const ageHours = ageMs / 3_600_000;
  const signalResult = evaluateRaidSignals({
    accountAgeMs: ageMs,
    accountAgeThresholdMs: config.antiRaid.minAccountAgeHours * 3_600_000,
    joinsInWindow: window.count,
    joinThreshold: config.antiRaid.joinThreshold,
  });
  const signals = [...signalResult.signals];
  const accountTooNew = config.antiRaid.minAccountAgeHours > 0 && ageHours < config.antiRaid.minAccountAgeHours;
  const noAvatar = config.antiRaid.flagNoAvatar && !member.user.avatar;
  if (noAvatar) signals.push("no_avatar");
  const suspicious = accountTooNew || noAvatar || window.active;
  const signalSaved = await recordEvent({
    guildId: guild.id,
    eventType: suspicious ? "anti_raid:signal" : "anti_raid:join",
    actorId: null,
    targetId: member.id,
    severity: window.started ? "high" : suspicious ? "medium" : "low",
    details: {
      accountAgeHours: Math.floor(ageHours),
      hasAvatar: Boolean(member.user.avatar),
      joinCount: window.count,
      signals,
      raidWindowActive: window.active,
    },
  });
  if (!signalSaved) {
    if (suspicious && (window.started || accountTooNew || noAvatar)) {
      await sendSecurityAlert(guild, config, config.antiRaid.alertChannelId, alertPayload(member, ageHours, signals, window.count, config));
    }
    return;
  }

  const protectedMode = enforcementEnabled(config);
  if (window.started && config.antiRaid.autoLockdown && protectedMode) {
    await activateLockdown(guild, config, {
      actorId: null,
      reason: `Anti-Raid burst: ${window.count} joins in ${config.antiRaid.windowSeconds}s`,
      trigger: "anti_raid",
      durationMinutes: config.antiRaid.raidModeMinutes,
    });
  }

  if (!suspicious) return;
  if (window.started || accountTooNew || noAvatar) {
    await sendSecurityAlert(guild, config, config.antiRaid.alertChannelId,
      alertPayload(member, ageHours, signals, window.count, config));
  }

  if (!protectedMode) return;
  const riskConfirmedByPolicy = accountTooNew || noAvatar;
  let selectedAction: "alert" | "timeout" | "kick" | "ban" = "alert";
  if (window.active && riskConfirmedByPolicy && config.antiRaid.raidAction !== "alert") {
    selectedAction = config.antiRaid.raidAction;
  } else if (accountTooNew) {
    selectedAction = config.antiRaid.newAccountAction === "none" ? "alert" : config.antiRaid.newAccountAction;
  }
  if (selectedAction === "alert") return;
  const caseRow = await recordCase(guild, config, {
    type: "antiraid", targetId: member.id, moderatorId: guild.client.user.id,
    reason: `محاولة ${selectedAction} بسبب إشارات: ${signals.join(", ") || "انضمام عالي المخاطر"}.`,
    source: "auto", active: false,
    durationSeconds: selectedAction === "timeout" ? config.antiRaid.timeoutMinutes * 60 : null,
    metadata: { signals, joinCount: window.count, accountAgeHours: Math.floor(ageHours), status: "pending" },
  });
  if (!caseRow) return;
  const result = await applyRaidAction(member, selectedAction, config,
    `Security Systemix Anti-Raid: ${signals.join(",") || "join risk"}`);
  await updateCaseReason(guild.id, caseRow.caseNumber, `إشارات: ${signals.join(", ") || "انضمام عالي المخاطر"} · ${result.result}`);
  if (result.applied) {
    if (selectedAction === "timeout") await setCaseActive(guild.id, caseRow.caseNumber, true);
    await recordEvent({
      guildId: guild.id,
      eventType: "anti_raid:action",
      actorId: guild.client.user.id,
      targetId: member.id,
      severity: "high",
      details: { action: selectedAction, signals, result: result.result },
    });
  }
}

export const antiRaidModule: SystemixModule = {
  name: "antiRaid",
  implemented: true,
  onMemberAdd,
};
