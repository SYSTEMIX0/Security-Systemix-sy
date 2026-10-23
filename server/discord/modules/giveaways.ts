import { randomInt } from "node:crypto";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, type ChatInputCommandInteraction, type Client, type Guild,
} from "discord.js";
import { getGuildConfig, hasAnyRole, logSafe, replyEphemeral, systemixEmbed } from "../core/context";
import { customId, type SystemixModule } from "../core/types";
import { cancelGiveaway, completeGiveaway, createGiveaway, getGiveaway, listDueGiveaways, listGiveawayEntries, enterGiveaway, setGiveawayMessage } from "../store/giveaways";

export function chooseGiveawayWinners<T>(eligible: readonly T[], count: number, rng: (maxExclusive: number) => number = randomInt): T[] {
  const pool = [...eligible];
  const result: T[] = [];
  const picks = Math.min(Math.max(0, Math.floor(count)), pool.length);
  for (let i = 0; i < picks; i++) {
    const index = rng(pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new RangeError("rng_out_of_range");
    result.push(pool[index]!);
    pool[index] = pool[pool.length - 1]!;
    pool.pop();
  }
  return result;
}

const create = new SlashCommandBuilder().setName("giveaway").setDescription("إدارة السحوبات")
  .addSubcommand((s) => s.setName("create").setDescription("إنشاء سحب")
    .addStringOption((o) => o.setName("prize").setDescription("الجائزة").setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 30m أو 2h أو 1d").setRequired(true))
    .addIntegerOption((o) => o.setName("winners").setDescription("عدد الفائزين").setMinValue(1).setMaxValue(20))
    .addStringOption((o) => o.setName("required_role").setDescription("معرّف الرتبة المطلوبة")))
  .addSubcommand((s) => s.setName("end").setDescription("إنهاء سحب").addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true).setMinValue(1)));

function canManage(interaction: ChatInputCommandInteraction<"cached">, cfg: Awaited<ReturnType<typeof getGuildConfig>>): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true || hasAnyRole(interaction.member, cfg.giveaways.managerRoleIds);
}

async function finishGiveaway(guild: Guild, id: number): Promise<boolean> {
  const row = await getGiveaway(guild.id, id);
  if (!row || row.status !== "running") return false;
  const entries = await listGiveawayEntries(guild.id, id);
  const eligible: string[] = [];
  if (row.requiredRoleId) {
    for (const userId of entries) {
      try { const member = await guild.members.fetch(userId); if (member.roles.cache.has(row.requiredRoleId)) eligible.push(userId); } catch { /* departed/ineligible */ }
    }
  } else eligible.push(...entries);
  const winners = chooseGiveawayWinners(eligible, row.winnerCount);
  // Commit the winner list and terminal status together after all reads/random selection succeeded.
  if (!(await completeGiveaway(guild.id, id, winners))) return false;
  try {
    const channel = await guild.channels.fetch(row.channelId);
    if (channel?.isTextBased() && "messages" in channel && row.messageId) {
      const msg = await channel.messages.fetch(row.messageId);
      await msg.edit({ embeds: [systemixEmbed({ title: "انتهى السحب", description: `الجائزة: **${row.prize}**\nالفائزون: ${winners.length ? winners.map((x) => `<@${x}>`).join(", ") : "لا يوجد مشاركون مؤهلون"}` })], components: [], allowedMentions: { parse: [], users: winners } });
    }
  } catch (error) { logSafe(`Giveaway result update failed in guild ${guild.id}`, error); }
  return true;
}

export const giveawaysModule: SystemixModule = {
  name: "giveaways", implemented: true, commands: [create.toJSON()], componentPrefix: "giveaways",
  async onCommand(interaction) {
    if (interaction.commandName !== "giveaway") return;
    const sub = interaction.options.getSubcommand();
    const config = await getGuildConfig(interaction.guildId);
    if (!canManage(interaction, config)) { await replyEphemeral(interaction, "لا تملك صلاحية إدارة السحوبات."); return; }
    if (sub === "create") {
      const prize = interaction.options.getString("prize", true).trim();
      const duration = parseDurationMs(interaction.options.getString("duration", true));
      const winnerCount = interaction.options.getInteger("winners") ?? 1;
      const roleId = interaction.options.getString("required_role");
      const channel = config.giveaways.defaultChannelId
        ? await interaction.guild?.channels.fetch(config.giveaways.defaultChannelId).catch(() => null)
        : interaction.channel;
      if (!interaction.guild || !channel || !channel.isTextBased() || !("send" in channel) || !prize || prize.length > 200 || !duration || duration < 60_000 || duration > 30 * 86400_000 || winnerCount < 1 || winnerCount > 20 || (roleId && !/^\d{17,20}$/.test(roleId))) { await replyEphemeral(interaction, "تحقق من القناة والجائزة والمدة (1 دقيقة إلى 30 يوماً) وعدد الفائزين والرتبة."); return; }
      const me = interaction.guild.members.me;
      const perms = me && channel.permissionsFor(me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) { await replyEphemeral(interaction, "لا أملك صلاحيات النشر والتضمينات في هذه القناة."); return; }
      if (roleId) {
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role || role.guild.id !== interaction.guildId) { await replyEphemeral(interaction, "الرتبة غير موجودة في هذا السيرفر."); return; }
      }
      await interaction.deferReply({ ephemeral: true });
      let id: number | null = null;
      try {
        id = await createGiveaway({ guildId: interaction.guildId, channelId: channel.id, hostId: interaction.user.id, prize, winnerCount, requiredRoleId: roleId, endsAt: new Date(Date.now() + duration) });
        const endsAt = new Date(Date.now() + duration);
        const msg = await channel.send({ embeds: [new EmbedBuilder().setTitle("سحب جديد").setDescription(`**${prize}**\nينتهي <t:${Math.floor(endsAt.getTime() / 1000)}:R>\nالفائزون: ${winnerCount}${roleId ? `\nالرتبة المطلوبة: <@&${roleId}>` : ""}`).setFooter({ text: `Giveaway #${id}` })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId("giveaways", id, "enter")).setLabel("شارك").setStyle(ButtonStyle.Success))], allowedMentions: { parse: [] } });
        await setGiveawayMessage(interaction.guildId, id, msg.id);
        await interaction.editReply({ content: `تم إنشاء السحب #${id}.` });
      } catch (error) {
        if (id !== null) await cancelGiveaway(interaction.guildId, id).catch(() => undefined);
        logSafe(`Giveaway creation failed in guild ${interaction.guildId}`, error);
        await interaction.editReply({ content: "تعذر إنشاء السحب؛ لم نتركه نشطاً في قاعدة البيانات." });
      }
    } else if (sub === "end") {
      const id = interaction.options.getInteger("id", true);
      const ended = await finishGiveaway(interaction.guild!, id);
      await replyEphemeral(interaction, ended ? `تم إنهاء السحب #${id}.` : "السحب غير موجود أو انتهى مسبقاً.");
    }
  },
  async onComponent(interaction) {
    if (!interaction.isButton()) return;
    const [idText, action] = interaction.customId.split(":").slice(2);
    const id = Number(idText);
    if (action !== "enter" || !Number.isSafeInteger(id)) return;
    const row = await getGiveaway(interaction.guildId, id);
    if (!row || row.guildId !== interaction.guildId || row.status !== "running" || row.channelId !== interaction.channelId || row.endsAt <= new Date()) { await replyEphemeral(interaction, "هذا السحب غير متاح."); return; }
    if (row.requiredRoleId && !interaction.member.roles.cache.has(row.requiredRoleId)) { await replyEphemeral(interaction, "تحتاج الرتبة المطلوبة للمشاركة."); return; }
    const added = await enterGiveaway(interaction.guildId, id, interaction.user.id);
    await replyEphemeral(interaction, added ? "تم تسجيل مشاركتك." : "أنت مشارك بالفعل.");
  },
  intervals: [{ name: "giveaways:end", everyMs: 30_000, async run(client) {
    for (const guild of client.guilds.cache.values()) {
      let due;
      try { due = await listDueGiveaways(guild.id, new Date()); } catch (error) { logSafe(`Giveaway scan failed in guild ${guild.id}`, error); continue; }
      for (const row of due) {
        try { await finishGiveaway(guild, row.id); } catch (error) { logSafe(`Giveaway end failed in guild ${guild.id}`, error); }
      }
    }
  } }],
};

function parseDurationMs(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d{1,6})\s*(s|sec|m|min|h|hr|d|day|w|week)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = ({ s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000, day: 86_400_000, w: 604_800_000, week: 604_800_000 } as Record<string, number>)[m[2] ?? "m"];
  return n > 0 ? n * unit : null;
}
