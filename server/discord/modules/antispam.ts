import { createHash } from "node:crypto";
import { PermissionFlagsBits, type GuildMember, type Message, type MessageCreateOptions, type PartialMessage } from "discord.js";
import type { GuildSecurityConfig } from "../config";
import {
  actorOutranks,
  enforcementEnabled,
  getGuildConfig,
  isTrustedActor,
  logSafe,
  recordCase,
  recordEvent,
  sendSecurityAlert,
  sendToChannel,
  systemixEmbed,
} from "../core/context";
import type { SystemixModule } from "../core/types";
import { pushSlidingSample } from "../limits";
import { setCaseActive, updateCaseReason } from "../store/cases";

const MAX_USER_WINDOWS = 20_000;
const MAX_EDITED_MESSAGES = 20_000;
type RecentHash = { hash: string; at: number };
type SpamWindow = { messages: number[]; hashes: RecentHash[]; lastActionAt: number; lastAlertAt: number };
const windows = new Map<string, SpamWindow>();
const editedMessages = new Map<string, number>();

export type SpamSignals = {
  flags: string[];
  messageCount: number;
  duplicateCount: number;
  mentionCount: number;
  capsPercent: number;
  blockedDomains: string[];
  next: SpamWindow;
};

export function extractLinkDomains(content: string): string[] {
  const matches = content.match(/(?:https?:\/\/|www\.)[^\s<>]+/gi) ?? [];
  const domains = new Set<string>();
  for (const raw of matches) {
    const candidate = raw.replace(/[),.!?\]}]+$/g, "");
    try {
      const url = new URL(candidate.startsWith("www.") ? `https://${candidate}` : candidate);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host) domains.add(host);
    } catch {
      // Invalid URLs are ignored; no untrusted value is fetched.
    }
  }
  return [...domains];
}

function domainAllowed(host: string, allowlisted: readonly string[]): boolean {
  return allowlisted.some((domain) => {
    const normalized = domain.toLowerCase().replace(/^www\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function evaluateSignals(input: {
  previous: SpamWindow;
  now: number;
  content: string;
  userMentions: number;
  roleMentions: number;
  mentionEveryone: boolean;
  config: GuildSecurityConfig["antiSpam"];
  countAsMessage: boolean;
}): SpamSignals {
  const windowMs = input.config.perSeconds * 1_000;
  const messages = input.countAsMessage
    ? pushSlidingSample(input.previous.messages, input.now, windowMs, 100)
    : input.previous.messages.filter((at) => input.now - at <= windowMs);
  const normalized = input.content.trim().replace(/\s+/g, " ").toLowerCase();
  const hash = normalized ? createHash("sha256").update(normalized).digest("hex").slice(0, 24) : "";
  const hashes = input.previous.hashes.filter((item) => input.now - item.at <= windowMs);
  const duplicateCount = hash ? hashes.filter((item) => item.hash === hash).length + 1 : 0;
  if (hash) hashes.push({ hash, at: input.now });
  const mentionCount = input.userMentions + input.roleMentions + (input.mentionEveryone ? 1 : 0);
  const letters = input.content.match(/[A-Za-z]/g) ?? [];
  const uppercase = input.content.match(/[A-Z]/g) ?? [];
  const capsPercent = letters.length ? Math.round((uppercase.length / letters.length) * 100) : 0;
  const blockedDomains = input.config.blockLinks
    ? extractLinkDomains(input.content).filter((host) => !domainAllowed(host, input.config.allowedDomains))
    : [];
  const flags: string[] = [];
  if (input.countAsMessage && messages.length >= input.config.maxMessages) flags.push("message_rate");
  if (input.config.duplicateLimit > 0 && duplicateCount >= input.config.duplicateLimit) flags.push("duplicate_content");
  if (input.config.maxMentions > 0 && mentionCount >= input.config.maxMentions) flags.push("mention_burst");
  if (input.config.capsPercent > 0 && letters.length >= 12 && capsPercent >= input.config.capsPercent) flags.push("excessive_caps");
  if (blockedDomains.length) flags.push("blocked_link");
  return {
    flags, messageCount: messages.length, duplicateCount, mentionCount, capsPercent, blockedDomains,
    next: { messages, hashes: hashes.slice(-100), lastActionAt: input.previous.lastActionAt, lastAlertAt: input.previous.lastAlertAt },
  };
}

export function evaluateSpamMessage(input: {
  previous: SpamWindow; now: number; content: string; userMentions: number; roleMentions: number;
  mentionEveryone: boolean; config: GuildSecurityConfig["antiSpam"];
}): SpamSignals {
  return evaluateSignals({ ...input, countAsMessage: true });
}

export function evaluateSpamEdit(input: {
  previous: SpamWindow; now: number; content: string; userMentions: number; roleMentions: number;
  mentionEveryone: boolean; config: GuildSecurityConfig["antiSpam"];
}): SpamSignals {
  return evaluateSignals({ ...input, countAsMessage: false });
}

function pruneWindows(): void {
  if (windows.size > MAX_USER_WINDOWS) {
    for (const [key, value] of windows) {
      const last = value.messages.at(-1) ?? 0;
      if (Date.now() - last > 10 * 60_000) windows.delete(key);
      if (windows.size <= MAX_USER_WINDOWS) break;
    }
    while (windows.size > MAX_USER_WINDOWS) {
      const oldest = windows.keys().next().value;
      if (!oldest) break;
      windows.delete(oldest);
    }
  }
  const now = Date.now();
  for (const [key, at] of editedMessages) if (now - at > 10 * 60_000) editedMessages.delete(key);
  while (editedMessages.size > MAX_EDITED_MESSAGES) {
    const oldest = editedMessages.keys().next().value;
    if (!oldest) break;
    editedMessages.delete(oldest);
  }
}

function alertPayload(userId: string, flags: string[], messageCount: number, config: GuildSecurityConfig): MessageCreateOptions {
  return {
    embeds: [systemixEmbed({
      title: "رصد سلوك رسائل مزعج", tone: "warning",
      description: "حُفظت مؤشرات مختصرة فقط؛ لم يُحفظ نص الرسالة أو الرابط في سجل الحماية.",
      fields: [
        { name: "العضو", value: `\`${userId}\``, inline: true },
        { name: "الإشارات", value: flags.join("، "), inline: true },
        { name: "عدد الرسائل في النافذة", value: String(messageCount), inline: true },
      ], config,
    })],
    allowedMentions: { parse: [] },
  };
}

async function applySpamAction(message: Message<true>, member: GuildMember, config: GuildSecurityConfig, signals: SpamSignals): Promise<string> {
  const action = config.antiSpam.action;
  const reason = `Security Systemix Anti-Spam: ${signals.flags.join(",")}`;
  const me = message.guild.members.me;
  try {
    if (action === "delete") {
      if (!me?.permissions.has(PermissionFlagsBits.ManageMessages)) return "missing_manage_messages";
      await message.delete();
      return "deleted";
    }
    if (action === "warn") {
      await sendToChannel(message.guild, message.channelId, {
        content: `<@${member.id}> تم رصد رسائل متكررة أو مخالفة لإعدادات السيرفر.`,
        allowedMentions: { parse: [] },
      });
      return "warned";
    }
    if (!me || !actorOutranks(me, member)) return "hierarchy_guard";
    if (action === "timeout") {
      if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return "missing_moderate_members";
      await member.timeout(config.antiSpam.timeoutMinutes * 60_000, reason);
      return "timed_out";
    }
    if (!me.permissions.has(PermissionFlagsBits.KickMembers)) return "missing_kick_members";
    await member.kick(reason);
    return "kicked";
  } catch (error) {
    logSafe(`Anti-Spam action failed in guild ${message.guildId}`, error);
    return "discord_action_failed";
  }
}

async function processSpam(message: Message<true>, member: GuildMember, config: GuildSecurityConfig, signals: SpamSignals, now: number, key: string, edited = false): Promise<void> {
  windows.set(key, signals.next);
  if (!signals.flags.length) return;
  const signalSaved = await recordEvent({
    guildId: message.guildId, eventType: "anti_spam:signal", actorId: message.author.id, targetId: null,
    severity: "medium",
    details: {
      flags: signals.flags, messageCount: signals.messageCount, duplicateCount: signals.duplicateCount,
      mentionCount: signals.mentionCount, blockedDomainCount: signals.blockedDomains.length,
    },
  });
  if (!signalSaved) return;
  if (now - signals.next.lastAlertAt >= 30_000) {
    await sendSecurityAlert(message.guild, config, config.antiSpam.alertChannelId, alertPayload(member.id, signals.flags, signals.messageCount, config));
    windows.set(key, { ...signals.next, lastAlertAt: now });
  }
  if (!enforcementEnabled(config)) return;
  if (config.antiSpam.action !== "delete" && now - signals.next.lastActionAt < 30_000) return;
  const attemptSaved = await recordEvent({
    guildId: message.guildId, eventType: "anti_spam:action_attempt", actorId: message.author.id,
    targetId: null, severity: "high", details: { action: config.antiSpam.action, flags: signals.flags },
  });
  if (!attemptSaved) return;
  const caseRow = config.antiSpam.action === "delete" ? null : await recordCase(message.guild, config, {
    type: config.antiSpam.action === "warn" ? "warn" : "antispam",
    targetId: member.id, moderatorId: message.client.user?.id ?? "0",
    reason: `محاولة إجراء Anti-Spam: ${signals.flags.join(", ")}.`, source: "auto", active: false,
    durationSeconds: config.antiSpam.action === "timeout" ? config.antiSpam.timeoutMinutes * 60 : null,
    metadata: { flags: signals.flags, status: "pending" },
  });
  if (config.antiSpam.action !== "delete" && !caseRow) return;
  const outcome = await applySpamAction(message, member, config, signals);
  const latest = windows.get(key) ?? signals.next;
  windows.set(key, { ...latest, lastActionAt: now });
  const applied = ["deleted", "timed_out", "kicked", "warned"].includes(outcome);
  if (caseRow) {
    await updateCaseReason(message.guildId, caseRow.caseNumber, `إشارات Anti-Spam: ${signals.flags.join(", ")} · ${outcome}`);
    if (applied && (outcome === "warned" || outcome === "timed_out")) await setCaseActive(message.guildId, caseRow.caseNumber, true);
  }
  await recordEvent({
    guildId: message.guildId, eventType: applied ? "anti_spam:action" : "anti_spam:action_blocked",
    actorId: message.author.id, targetId: null, severity: applied ? "high" : "medium",
    details: { action: config.antiSpam.action, outcome, flags: signals.flags, ...(edited ? { source: "message_edit" } : {}) },
  });
}

async function onMessage(message: Message<true>): Promise<void> {
  const config = await getGuildConfig(message.guildId);
  if (!config.antiSpam.enabled || message.author.bot || config.antiSpam.exemptChannelIds.includes(message.channelId)) return;
  const member = message.member;
  if (!member || isTrustedActor(member, config, config.antiSpam.exemptRoleIds)) return;
  const now = Date.now();
  pruneWindows();
  const key = `${message.guildId}|${message.author.id}`;
  const previous = windows.get(key) ?? { messages: [], hashes: [], lastActionAt: 0, lastAlertAt: 0 };
  const signals = evaluateSpamMessage({
    previous, now, content: message.content, userMentions: message.mentions.users.size,
    roleMentions: message.mentions.roles.size, mentionEveryone: message.mentions.everyone, config: config.antiSpam,
  });
  await processSpam(message, member, config, signals, now, key);
}

async function onMessageUpdate(_before: Message<true> | PartialMessage, message: Message<true>): Promise<void> {
  if (!message.guildId || !message.guild || message.author.bot) return;
  const config = await getGuildConfig(message.guildId);
  if (!config.antiSpam.enabled || config.antiSpam.exemptChannelIds.includes(message.channelId)) return;
  const member = message.member;
  if (!member || isTrustedActor(member, config, config.antiSpam.exemptRoleIds)) return;
  const now = Date.now();
  pruneWindows();
  const editedKey = `${message.guildId}|${message.id}`;
  if (editedMessages.has(editedKey)) return;
  const key = `${message.guildId}|${message.author.id}`;
  const previous = windows.get(key) ?? { messages: [], hashes: [], lastActionAt: 0, lastAlertAt: 0 };
  const signals = evaluateSpamEdit({
    previous, now, content: message.content, userMentions: message.mentions.users.size,
    roleMentions: message.mentions.roles.size, mentionEveryone: message.mentions.everyone, config: config.antiSpam,
  });
  if (!signals.flags.length) {
    windows.set(key, signals.next);
    return;
  }
  // Remember only flagged edits; re-edits of a handled message cannot cause another punishment.
  editedMessages.set(editedKey, now);
  await processSpam(message, member, config, signals, now, key, true);
}

export const antiSpamModule: SystemixModule = {
  name: "antiSpam",
  implemented: true,
  onMessage,
  onMessageUpdate,
};
