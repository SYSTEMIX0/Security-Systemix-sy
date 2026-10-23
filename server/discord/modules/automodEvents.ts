import type { AutoModerationActionExecution } from "discord.js";
import { bumpStat, getGuildConfig, recordEvent, sendSecurityAlert, systemixEmbed } from "../core/context";
import type { SystemixModule } from "../core/types";

function actionLabel(execution: AutoModerationActionExecution): string {
  return `action_${Number(execution.action.type)}`;
}

async function onAutoModAction(execution: AutoModerationActionExecution): Promise<void> {
  const guild = execution.guild;
  const config = await getGuildConfig(guild.id);
  if (!config.autoMod.enabled) return;
  const label = actionLabel(execution);
  await recordEvent({
    guildId: guild.id,
    eventType: "automod:action",
    actorId: null,
    targetId: execution.userId,
    severity: "medium",
    details: {
      ruleId: execution.ruleId,
      ruleTriggerType: Number(execution.ruleTriggerType),
      action: label,
      channelId: execution.channelId,
      messageId: execution.messageId,
      // matchedContent/matchedKeyword are intentionally excluded to avoid retaining user text.
    },
  });
  bumpStat(guild.id, "autoActions");
  if (!config.autoMod.alertChannelId) return;
  await sendSecurityAlert(guild, config, config.autoMod.alertChannelId, {
    embeds: [systemixEmbed({
      title: "نفّذ Discord AutoMod إجراءً",
      tone: "warning",
      fields: [
        { name: "العضو", value: execution.userId ? `\`${execution.userId}\`` : "غير متاح", inline: true },
        { name: "القاعدة", value: `\`${execution.ruleId}\``, inline: true },
        { name: "الإجراء", value: label, inline: true },
      ],
      description: "لم يُحفظ محتوى الرسالة أو الكلمات المطابقة.",
      config,
    })],
    allowedMentions: { parse: [] },
  });
}

export const autoModModule: SystemixModule = {
  name: "autoMod",
  implemented: true,
  onAutoModAction,
};
