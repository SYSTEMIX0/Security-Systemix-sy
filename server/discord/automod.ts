import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type Guild,
} from "discord.js";
import type { GuildSecurityConfig } from "./config";

export type AutoModChange = { name: string; id: string; action: "created" | "updated" | "unchanged" | "disabled" };

const SYSTEMIX_RULE_NAMES = new Set([
  "Systemix — روابط ودعوات",
  "Systemix — المنشن الجماعي",
]);

export function isSystemixAutoModRule(rule: { name: string; creatorId: string | null }, botId: string): boolean {
  return rule.creatorId === botId && SYSTEMIX_RULE_NAMES.has(rule.name);
}

export class AutoModRuleConflict extends Error {
  constructor() {
    super("A same-name AutoMod rule belongs to another creator");
    this.name = "AutoModRuleConflict";
  }
}

export async function applyNativeAutoModRules(
  guild: Guild,
  config: GuildSecurityConfig,
): Promise<AutoModChange[]> {
  const desired: Array<{
    name: string;
    triggerType: AutoModerationRuleTriggerType;
    triggerMetadata?: { keywordFilter?: string[]; mentionTotalLimit?: number };
  }> = [];

  const inviteAndKeywords = config.autoMod.enabled
    ? [
        ...(config.autoMod.blockInvites ? ["discord.gg/*", "discord.com/invite/*"] : []),
        ...config.autoMod.blockedKeywords,
      ]
    : [];
  if (inviteAndKeywords.length > 0) {
    desired.push({
      name: "Systemix — روابط ودعوات",
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: [...new Set(inviteAndKeywords)].slice(0, 100) },
    });
  }
  if (config.autoMod.enabled && config.autoMod.blockMentionSpam) {
    desired.push({
      name: "Systemix — المنشن الجماعي",
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: config.autoMod.mentionLimit },
    });
  }
  const currentRules = await guild.autoModerationRules.fetch();
  const botId = guild.client.user?.id;
  if (!botId) throw new Error("Discord client is not ready");
  for (const spec of desired) {
    const existing = currentRules.find((rule) => rule.name === spec.name);
    if (existing && existing.creatorId !== botId) throw new AutoModRuleConflict();
  }

  const changes: AutoModChange[] = [];
  for (const spec of desired) {
    const existing = currentRules.find((rule) => rule.name === spec.name);
    const actions = [
      { type: AutoModerationActionType.BlockMessage },
      ...(config.autoMod.alertChannelId
        ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: config.autoMod.alertChannelId } }]
        : []),
    ];
    const options = {
      name: spec.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: spec.triggerType,
      triggerMetadata: spec.triggerMetadata,
      actions,
      enabled: true,
      reason: "تم تطبيق قاعدة AutoMod بناء على طلب مسؤول السيرفر من لوحة Security Systemix",
    };

    if (existing) {
      const updated = await existing.edit(options);
      changes.push({ name: updated.name, id: updated.id, action: "updated" });
      continue;
    }
    const created = await guild.autoModerationRules.create(options);
    changes.push({ name: created.name, id: created.id, action: "created" });
  }

  const desiredNames = new Set(desired.map((spec) => spec.name));
  for (const rule of currentRules.values()) {
    if (!SYSTEMIX_RULE_NAMES.has(rule.name) || desiredNames.has(rule.name) || rule.creatorId !== botId || !rule.enabled) continue;
    const disabled = await rule.edit({
      enabled: false,
      reason: "تم تعطيل قاعدة Systemix بعد طلب مسؤول السيرفر مزامنة الإعدادات.",
    });
    changes.push({ name: disabled.name, id: disabled.id, action: "disabled" });
  }
  return changes;
}
