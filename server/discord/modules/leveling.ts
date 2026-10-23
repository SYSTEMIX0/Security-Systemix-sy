import { PermissionFlagsBits } from "discord.js";
import type { SystemixModule } from "../core/types";
import { formatTemplate, getGuildConfig, isSafeGrantRole, sendToChannel } from "../core/context";
import { logSafe } from "../core/context";
import { addMemberXp, updateMemberLevel } from "../store/leveling";

/** Cumulative curve: level L requires 100 * L² total XP (100, 400, 900, ...). */
export function levelForXp(xp: number): number {
  return Number.isFinite(xp) && xp > 0 ? Math.floor(Math.sqrt(xp / 100)) : 0;
}
export function xpForNextLevel(level: number): number {
  return 100 * (Math.max(0, Math.floor(level)) + 1) ** 2;
}

/** Bounded process-local cooldown keyed by guild/user. Accepted messages return true. */
export class LevelCooldown {
  private readonly timestamps = new Map<string, number>();
  constructor(private readonly capacity = 50_000) {}
  accept(guildId: string, userId: string, now: number, cooldownMs: number): boolean {
    const key = `${guildId}:${userId}`;
    const previous = this.timestamps.get(key);
    if (previous !== undefined && now - previous < cooldownMs) return false;
    this.timestamps.delete(key);
    if (this.timestamps.size >= this.capacity) {
      const oldest = this.timestamps.keys().next().value;
      if (oldest !== undefined) this.timestamps.delete(oldest);
    }
    this.timestamps.set(key, now);
    return true;
  }
}
const cooldown = new LevelCooldown();

export const levelingModule: SystemixModule = {
  name: "leveling",
  implemented: true,
  onMessage: async (message) => {
    if (!message.guild || !message.member || message.author.bot) return;
    const cfg = await getGuildConfig(message.guild.id);
    const settings = cfg.leveling;
    if (!settings.enabled || settings.ignoredChannelIds.includes(message.channelId) || settings.noXpRoleIds.some((id) => message.member!.roles.cache.has(id))) return;
    if (!cooldown.accept(message.guild.id, message.author.id, Date.now(), settings.cooldownSeconds * 1000)) return;
    const min = Math.min(settings.xpMin, settings.xpMax);
    const max = Math.max(settings.xpMin, settings.xpMax);
    try {
      const row = await addMemberXp(message.guild.id, message.author.id, min + Math.floor(Math.random() * (max - min + 1)));
      const earnedLevel = levelForXp(row.xp);
      if (earnedLevel <= row.level) return;
      await updateMemberLevel(message.guild.id, message.author.id, earnedLevel);
      const nextLevel = earnedLevel;
      const botMember = message.guild.members.me;
      if (botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        const eligible = settings.rewards.filter((reward) => reward.level <= nextLevel && (settings.stackRewards || reward.level === nextLevel));
        for (const reward of eligible) {
          const role = message.guild.roles.cache.get(reward.roleId) ?? await message.guild.roles.fetch(reward.roleId).catch(() => null);
          if (role && isSafeGrantRole(role) && !message.member.roles.cache.has(role.id)) await message.member.roles.add(role).catch(() => undefined);
        }
      }
      if (settings.announce !== "off") {
        const channel = settings.announce === "channel" ? settings.announceChannelId : message.channelId;
        const content = formatTemplate(settings.announceMessage, { user: `<@${message.author.id}>`, level: nextLevel });
        await sendToChannel(message.guild, channel, { content, allowedMentions: { parse: [], users: [message.author.id], roles: [], repliedUser: false } });
      }
    } catch (error) {
      logSafe(`Leveling update failed for guild ${message.guild.id}` , error);
    }
  },
};
