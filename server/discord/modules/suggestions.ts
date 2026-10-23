import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SystemixModule } from "../core/types";
import { getGuildConfig, replyEphemeral, logSafe } from "../core/context";
import { createSuggestion, getSuggestion, reviewSuggestion, setSuggestionMessage } from "../store/suggestions";

export const SUGGESTION_CONTENT_MAX = 1800;
export function normalizeSuggestionContent(value: string): string { return value.trim().replace(/\r\n?/g, "\n"); }
export function publicAuthorLabel(anonymous: boolean, authorId: string): string { return anonymous ? "مجهول" : `<@${authorId}>`; }
export function canReviewSuggestion(memberRoleIds: readonly string[], reviewerRoleIds: readonly string[]): boolean {
  return reviewerRoleIds.some((roleId) => memberRoleIds.includes(roleId));
}
export function suggestionEmbed(row: { suggestionNumber: number; content: string; anonymous: boolean; authorId: string; status: string; reviewNote: string | null }): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`اقتراح #${row.suggestionNumber}`).setDescription(row.content.slice(0, SUGGESTION_CONTENT_MAX))
    .addFields({ name: "الحالة", value: statusLabel(row.status), inline: true }, { name: "المقترح", value: publicAuthorLabel(row.anonymous, row.authorId), inline: true })
    .setColor(row.status === "rejected" ? 0xff7779 : row.status === "implemented" ? 0x6fdc9a : 0xb7f47b);
  if (row.reviewNote) embed.addFields({ name: "ملاحظة المراجعة", value: row.reviewNote.slice(0, 512) });
  return embed;
}
function statusLabel(status: string): string { return ({ pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض", implemented: "تم التنفيذ" } as Record<string, string>)[status] ?? "قيد المراجعة"; }

const command = new SlashCommandBuilder().setName("suggest").setDescription("إرسال اقتراح أو مراجعته")
  .addSubcommand((sub) => sub.setName("submit").setDescription("إرسال اقتراح جديد").addStringOption((opt) => opt.setName("content").setDescription("نص الاقتراح").setRequired(true).setMaxLength(SUGGESTION_CONTENT_MAX)).addBooleanOption((opt) => opt.setName("anonymous").setDescription("إخفاء هويتك عن العامة")))
  .addSubcommand((sub) => sub.setName("approve").setDescription("قبول اقتراح").addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1)).addStringOption((o) => o.setName("note").setDescription("ملاحظة المراجعة").setMaxLength(512)))
  .addSubcommand((sub) => sub.setName("reject").setDescription("رفض اقتراح").addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1)).addStringOption((o) => o.setName("note").setDescription("ملاحظة المراجعة").setMaxLength(512)))
  .addSubcommand((sub) => sub.setName("implemented").setDescription("تعليم الاقتراح كمنفذ").addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1)).addStringOption((o) => o.setName("note").setDescription("ملاحظة المراجعة").setMaxLength(512)));

async function handleCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  const settings = config.suggestions;
  if (!settings.enabled) { await replyEphemeral(interaction, "ميزة الاقتراحات غير مفعلة."); return; }
  const sub = interaction.options.getSubcommand();
  if (sub === "submit") {
    if (!settings.channelId) { await replyEphemeral(interaction, "لم يتم ضبط قناة الاقتراحات."); return; }
    const content = normalizeSuggestionContent(interaction.options.getString("content", true));
    if (!content || content.length > SUGGESTION_CONTENT_MAX) { await replyEphemeral(interaction, `يجب أن يكون النص بين 1 و${SUGGESTION_CONTENT_MAX} حرفاً.`); return; }
    const anonymous = settings.allowAnonymous && interaction.options.getBoolean("anonymous") === true;
    try {
      const row = await createSuggestion({ guildId: interaction.guildId, channelId: settings.channelId, authorId: interaction.user.id, anonymous, content });
      const channel = interaction.guild.channels.cache.get(settings.channelId) ?? await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
      if (!channel?.isTextBased() || !("send" in channel)) { await replyEphemeral(interaction, "تعذر الوصول إلى قناة الاقتراحات؛ حُفظ الاقتراح داخلياً دون نشره."); return; }
      const me = interaction.guild.members.me;
      const perms = me ? channel.permissionsFor(me) : null;
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) { await replyEphemeral(interaction, "لا أملك صلاحيات النشر المطلوبة؛ حُفظ الاقتراح داخلياً دون نشره."); return; }
      const message = await channel.send({ embeds: [suggestionEmbed(row)], allowedMentions: { parse: [] } });
      await setSuggestionMessage(interaction.guildId, row.id, message.id);
      await replyEphemeral(interaction, `تم إرسال الاقتراح رقم **${row.suggestionNumber}**.`);
    } catch (error) { logSafe(`Suggestion submit failed for guild ${interaction.guildId}`, error); await replyEphemeral(interaction, "تعذر حفظ الاقتراح حالياً."); }
    return;
  }
  const member = interaction.member;
  const roleIds = Array.from(member.roles.cache.keys());
  if (!canReviewSuggestion(roleIds, settings.reviewerRoleIds)) { await replyEphemeral(interaction, "هذا الإجراء مخصص للمراجعين."); return; }
  const number = interaction.options.getInteger("number", true);
  const note = interaction.options.getString("note")?.trim().slice(0, 512) || null;
  const status = sub as "approved" | "rejected" | "implemented";
  try {
    const existing = await getSuggestion(interaction.guildId, number);
    if (!existing) { await replyEphemeral(interaction, "لم يتم العثور على هذا الاقتراح في هذا السيرفر."); return; }
    // Persist reviewer/status/note first; public message is only changed after durable review succeeds.
    const updated = await reviewSuggestion({ guildId: interaction.guildId, number, reviewerId: interaction.user.id, status, note });
    if (!updated) { await replyEphemeral(interaction, "تعذر تسجيل المراجعة."); return; }
    if (existing.messageId) {
      const channel = interaction.guild.channels.cache.get(existing.channelId) ?? await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
      if (channel?.isTextBased() && "messages" in channel) {
        const message = await channel.messages.fetch(existing.messageId).catch(() => null);
        if (message) await message.edit({ embeds: [suggestionEmbed(updated)], allowedMentions: { parse: [] } });
      }
    }
    await replyEphemeral(interaction, `تم تحديث حالة الاقتراح #${number} إلى ${statusLabel(status)}.`);
  } catch (error) { logSafe(`Suggestion review failed for guild ${interaction.guildId}`, error); await replyEphemeral(interaction, "تعذر تسجيل المراجعة حالياً."); }
}

export const suggestionsModule: SystemixModule = { name: "suggestions", implemented: true, commands: [command.toJSON()], onCommand: handleCommand };
