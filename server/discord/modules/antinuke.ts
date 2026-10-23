import { PermissionFlagsBits, type AuditLogEvent, type Guild, type GuildAuditLogsEntry, type GuildMember, type MessageCreateOptions } from "discord.js";
import { ANTI_NUKE_ACTIONS, type AntiNukeAction, type GuildSecurityConfig } from "../config";
import {
  actorOutranks,
  enforcementEnabled,
  getGuildConfig,
  isAssignableRole,
  isDangerousRole,
  isTrustedActor,
  logSafe,
  recordCase,
  recordEvent,
  sendSecurityAlert,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { pushSlidingSample } from "../limits";
import { monitoredAuditActionNames } from "../security";
import { setCaseActive, updateCaseReason } from "../store/cases";
import { activateLockdown } from "./lockdown";
import { createGuildBackup } from "./backups";

const MAX_TRACKED_WINDOWS = 5_000;
type WindowState = { samples: number[]; lastTriggeredAt: number };
const actionWindows = new Map<string, WindowState>();

export function mapAuditAction(action: AuditLogEvent): AntiNukeAction | null {
  const name = monitoredAuditActionNames.get(action);
  return name && ANTI_NUKE_ACTIONS.includes(name as AntiNukeAction) ? name as AntiNukeAction : null;
}

export function advanceNukeWindow(
  previous: WindowState,
  now: number,
  windowMs: number,
  threshold: number,
): { state: WindowState; count: number; triggered: boolean } {
  const samples = pushSlidingSample(previous.samples, now, windowMs, Math.max(threshold * 4, 20));
  const count = samples.length;
  const triggered = count >= threshold && now - previous.lastTriggeredAt >= windowMs;
  return {
    state: { samples, lastTriggeredAt: triggered ? now : previous.lastTriggeredAt },
    count,
    triggered,
  };
}

function pruneWindows(now: number): void {
  if (actionWindows.size <= MAX_TRACKED_WINDOWS) return;
  for (const [key, value] of actionWindows) {
    const last = value.samples.at(-1) ?? 0;
    if (now - last > 10 * 60_000) actionWindows.delete(key);
    if (actionWindows.size <= MAX_TRACKED_WINDOWS) return;
  }
  while (actionWindows.size > MAX_TRACKED_WINDOWS) {
    const oldest = actionWindows.keys().next().value;
    if (!oldest) break;
    actionWindows.delete(oldest);
  }
}

function alertPayload(action: AntiNukeAction, count: number, threshold: number, actorId: string, targetId: string | null, protectedMode: boolean): MessageCreateOptions {
  return {
    embeds: [systemixEmbed({
      title: "رصد نشاط إداري غير معتاد",
      tone: protectedMode ? "danger" : "warning",
      description: "رصد Security Systemix تجاوز العتبة الزمنية. لم يُخزَّن محتوى الرسائل أو بيانات دخول.",
      fields: [
        { name: "نوع الإجراء", value: action, inline: true },
        { name: "المنفذ", value: `\`${actorId}\``, inline: true },
        { name: "العدد / العتبة", value: `${count} / ${threshold}`, inline: true },
        ...(targetId ? [{ name: "المستهدف", value: `\`${targetId}\``, inline: true }] : []),
        { name: "الوضع", value: protectedMode ? "حماية مفعّلة" : "مراقبة فقط — دون عقوبة", inline: true },
      ],
    })],
    allowedMentions: { parse: [] },
  };
}

async function punishActor(
  guild: Guild,
  actor: GuildMember,
  config: GuildSecurityConfig,
  action: AntiNukeAction,
): Promise<{ applied: boolean; result: string }> {
  const me = guild.members.me;
  if (!me || actor.id === guild.ownerId || !actorOutranks(me, actor)) return { applied: false, result: "hierarchy_guard" };
  const reason = `Security Systemix Anti-Nuke: ${action}`;
  try {
    switch (config.antiNuke.punishment) {
      case "alert":
        return { applied: false, result: "alert_only" };
      case "strip_roles": {
        const roleIds = [...actor.roles.cache.values()]
          .filter((role) => role.id !== guild.id && isAssignableRole(role) && isDangerousRole(role))
          .map((role) => role.id);
        if (!roleIds.length) return { applied: false, result: "no_assignable_dangerous_roles" };
        await actor.roles.remove(roleIds, reason);
        return { applied: true, result: "dangerous_roles_removed" };
      }
      case "timeout":
        if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return { applied: false, result: "missing_moderate_members" };
        await actor.timeout(config.antiNuke.timeoutMinutes * 60_000, reason);
        return { applied: true, result: "timed_out" };
      case "kick":
        if (!me.permissions.has(PermissionFlagsBits.KickMembers)) return { applied: false, result: "missing_kick_members" };
        await actor.kick(reason);
        return { applied: true, result: "kicked" };
      case "ban":
        if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return { applied: false, result: "missing_ban_members" };
        await actor.ban({ reason });
        return { applied: true, result: "banned" };
    }
  } catch (error) {
    logSafe(`Anti-Nuke punishment failed for guild ${guild.id}`, error);
    return { applied: false, result: "discord_action_failed" };
  }
}

async function onAuditLog(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
  const config = await getGuildConfig(guild.id);
  if (!config.antiNuke.enabled) return;
  const action = mapAuditAction(entry.action);
  if (!action || !config.antiNuke.monitoredActions.includes(action)) return;
  const actorId = entry.executorId ?? null;
  const targetId = entry.targetId ?? null;
  const actor = actorId ? await guild.members.fetch(actorId).catch(() => null) : null;
  const trusted = isTrustedActor(actor, config, config.general.staffRoleIds);
  await recordEvent({
    guildId: guild.id,
    eventType: `anti_nuke:${action}`,
    actorId,
    targetId,
    severity: trusted ? "low" : "medium",
    details: { action, trusted, auditEntryId: entry.id },
  });
  if (trusted || !actorId) return;

  const now = Date.now();
  pruneWindows(now);
  const key = `${guild.id}|${actorId}|${action}`;
  const previous = actionWindows.get(key) ?? { samples: [], lastTriggeredAt: Number.NEGATIVE_INFINITY };
  const result = advanceNukeWindow(previous, now, config.antiNuke.windowSeconds * 1_000, config.antiNuke.threshold);
  actionWindows.set(key, result.state);

  let addedBot: GuildMember | null = null;
  if (action === "bot_add" && actor && config.antiNuke.kickUnauthorizedBots && targetId) {
    const candidate = await guild.members.fetch(targetId).catch(() => null);
    if (candidate?.user.bot) addedBot = candidate;
  }
  const protectedMode = enforcementEnabled(config);
  const immediateBotSignal = Boolean(addedBot && config.antiNuke.kickUnauthorizedBots);
  if (!result.triggered && !immediateBotSignal) return;

  const triggerLogged = await recordEvent({
    guildId: guild.id,
    eventType: result.triggered ? "anti_nuke:threshold" : "anti_nuke:unauthorized_bot",
    actorId,
    targetId,
    severity: "high",
    details: { action, count: result.count, threshold: config.antiNuke.threshold, thresholdReached: result.triggered, botCandidateId: addedBot?.id ?? null },
  });
  await sendSecurityAlert(guild, config, config.antiNuke.alertChannelId,
    alertPayload(action, result.count, config.antiNuke.threshold, actorId, targetId, protectedMode));
  if (!triggerLogged) return;

  if (config.antiNuke.snapshotOnTrigger) {
    await createGuildBackup(guild, guild.client.user.id, "pre_incident", `قبل حادثة Anti-Nuke: ${action}`);
  }
  if (config.antiNuke.lockdownOnTrigger && protectedMode && result.triggered) {
    await activateLockdown(guild, config, {
      actorId,
      reason: `Anti-Nuke threshold: ${action}`,
      trigger: "anti_nuke",
    });
  }
  if (addedBot && protectedMode) {
    const me = guild.members.me;
    if (me?.permissions.has(PermissionFlagsBits.KickMembers) && actorOutranks(me, addedBot)) {
      const botCase = await recordCase(guild, config, {
        type: "unauthorized_bot_kick", targetId: addedBot.id, moderatorId: guild.client.user.id,
        reason: "محاولة طرد بوت أُضيف بواسطة منفذ غير مصرح به.", source: "auto", active: false,
        metadata: { action, actorId, status: "pending" },
      });
      if (botCase) {
        try {
          await addedBot.kick("Security Systemix: unauthorized bot addition");
          await updateCaseReason(guild.id, botCase.caseNumber, "طُرد البوت بعد إضافة غير مصرح بها وفق سياسة Anti-Nuke.");
          await recordEvent({ guildId: guild.id, eventType: "anti_nuke:unauthorized_bot_kicked", actorId: guild.client.user.id, targetId: addedBot.id, severity: "high", details: { executorId: actorId } });
        } catch (error) {
          await updateCaseReason(guild.id, botCase.caseNumber, "تعذر طرد البوت؛ راجع ترتيب الرتب والصلاحيات.");
          logSafe(`Unauthorized bot removal failed in guild ${guild.id}`, error);
        }
      }
    }
  }
  if (!protectedMode || !result.triggered) return;
  if (!actorId || !actor) {
    await recordEvent({ guildId: guild.id, eventType: "anti_nuke:action_blocked", actorId, targetId, severity: "high", details: { action, result: "executor_member_unavailable" } });
    return;
  }
  if (config.antiNuke.punishment === "alert") return;
  const caseRow = await recordCase(guild, config, {
    type: "antinuke", targetId: actorId, moderatorId: guild.client.user.id,
    reason: `محاولة عقوبة Anti-Nuke قيد التنفيذ بعد ${result.count} إجراءات ${action} خلال ${config.antiNuke.windowSeconds} ثانية.`,
    source: "auto", active: false,
    durationSeconds: config.antiNuke.punishment === "timeout" ? config.antiNuke.timeoutMinutes * 60 : null,
    metadata: { action, count: result.count, threshold: config.antiNuke.threshold, status: "pending" },
  });
  if (!caseRow) return;
  const outcome = await punishActor(guild, actor, config, action);
  await updateCaseReason(guild.id, caseRow.caseNumber,
    outcome.applied ? `تم تطبيق ${outcome.result} بعد ${result.count} إجراءات ${action} خلال ${config.antiNuke.windowSeconds} ثانية.` : `لم تُنفذ العقوبة: ${outcome.result}.`);
  if (outcome.applied && outcome.result === "timed_out") await setCaseActive(guild.id, caseRow.caseNumber, true);
  if (!outcome.applied) {
    await recordEvent({ guildId: guild.id, eventType: "anti_nuke:action_blocked", actorId, targetId, severity: "high", details: { action, result: outcome.result } });
  }
}

export const antiNukeModule: SystemixModule = {
  name: "antiNuke",
  implemented: true,
  onAuditLog,
};
