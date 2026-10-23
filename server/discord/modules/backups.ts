import {
  ChannelType,
  SlashCommandBuilder,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type PermissionOverwriteManager,
} from "discord.js";
import type { GuildBackupRow } from "../../../drizzle/schema";
import { getGuildConfig, isStaffMember, logSafe, recordEvent, replyEphemeral } from "../core/context";
import type { SystemixModule } from "../core/types";
import { getLatestGuildBackup, insertGuildBackup, trimGuildBackups } from "../store/backups";

export const MAX_BACKUP_BYTES = 1_000_000;
type SnapshotRole = {
  id: string; name: string; permissions: string; position: number; color: number;
  hoist: boolean; mentionable: boolean; managed: boolean;
};
type SnapshotOverwrite = { id: string; type: number; allow: string; deny: string };
type SnapshotChannel = {
  id: string; name: string; type: number; parentId: string | null; position: number;
  topic?: string; nsfw?: boolean; rateLimitPerUser?: number; overwrites: SnapshotOverwrite[];
};
type StructureSnapshot = { version: 1; roles: SnapshotRole[]; channels: SnapshotChannel[] };

type LockableGuildChannel = GuildBasedChannel & { permissionOverwrites: PermissionOverwriteManager };
function hasPermissionOverwrites(channel: GuildBasedChannel): channel is LockableGuildChannel {
  return "permissionOverwrites" in channel;
}

/** Builds a whitelist-only structure export; unknown fields such as messages are discarded. */
export function serializeGuildStructure(input: { roles: SnapshotRole[]; channels: SnapshotChannel[] }): {
  data: string; roleCount: number; channelCount: number;
} {
  const snapshot: StructureSnapshot = {
    version: 1,
    roles: input.roles.map((role) => ({
      id: role.id, name: role.name, permissions: role.permissions, position: role.position,
      color: role.color, hoist: role.hoist, mentionable: role.mentionable, managed: role.managed,
    })),
    channels: input.channels.map((channel) => ({
      id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId,
      position: channel.position,
      ...(channel.topic === undefined ? {} : { topic: channel.topic }),
      ...(channel.nsfw === undefined ? {} : { nsfw: channel.nsfw }),
      ...(channel.rateLimitPerUser === undefined ? {} : { rateLimitPerUser: channel.rateLimitPerUser }),
      overwrites: channel.overwrites.map((overwrite) => ({
        id: overwrite.id, type: overwrite.type, allow: overwrite.allow, deny: overwrite.deny,
      })),
    })),
  };
  const data = JSON.stringify(snapshot);
  if (Buffer.byteLength(data, "utf8") > MAX_BACKUP_BYTES) throw new Error("backup_size_limit");
  return { data, roleCount: snapshot.roles.length, channelCount: snapshot.channels.length };
}

function snapshotRole(role: Guild["roles"]["cache"] extends Map<string, infer R> ? R : never): SnapshotRole {
  return {
    id: role.id,
    name: role.name,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
  };
}

function snapshotChannel(channel: LockableGuildChannel): SnapshotChannel {
  const candidate = channel as LockableGuildChannel & Record<string, unknown>;
  const topic = typeof candidate.topic === "string" ? candidate.topic : undefined;
  const nsfw = typeof candidate.nsfw === "boolean" ? candidate.nsfw : undefined;
  const rateLimitPerUser = typeof candidate.rateLimitPerUser === "number" ? candidate.rateLimitPerUser : undefined;
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: "position" in channel && typeof channel.position === "number" ? channel.position : 0,
    ...(topic === undefined ? {} : { topic }),
    ...(nsfw === undefined ? {} : { nsfw }),
    ...(rateLimitPerUser === undefined ? {} : { rateLimitPerUser }),
    overwrites: [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    })),
  };
}

function collectStructure(guild: Guild) {
  const roles = [...guild.roles.cache.values()].map(snapshotRole);
  const channels = [...guild.channels.cache.values()]
    .filter((channel): channel is LockableGuildChannel => hasPermissionOverwrites(channel))
    .filter((channel) => channel.type !== ChannelType.PublicThread
      && channel.type !== ChannelType.PrivateThread
      && channel.type !== ChannelType.AnnouncementThread)
    .map(snapshotChannel);
  return serializeGuildStructure({ roles, channels });
}

export async function createGuildBackup(
  guild: Guild,
  createdById: string,
  kind: "manual" | "auto" | "pre_incident",
  label: string,
): Promise<GuildBackupRow | null> {
  try {
    const snapshot = collectStructure(guild);
    const row = await insertGuildBackup({
      guildId: guild.id,
      createdById,
      kind,
      label: label.slice(0, 100),
      roleCount: snapshot.roleCount,
      channelCount: snapshot.channelCount,
      data: snapshot.data,
    });
    const config = await getGuildConfig(guild.id);
    await trimGuildBackups(guild.id, config.backups.retain);
    await recordEvent({
      guildId: guild.id,
      eventType: "backup_created",
      actorId: createdById,
      severity: "low",
      details: { backupId: row.id, kind, roleCount: row.roleCount, channelCount: row.channelCount },
    });
    return row;
  } catch (error) {
    logSafe(`Backup creation failed for guild ${guild.id}`, error);
    return null;
  }
}

async function takeAutoBackupIfDue(guild: Guild, actorId: string): Promise<void> {
  const config = await getGuildConfig(guild.id);
  const intervalHours = config.backups.autoBackupHours;
  if (intervalHours <= 0) return;
  const latest = await getLatestGuildBackup(guild.id, "auto");
  if (latest && Date.now() - latest.createdAt.getTime() < intervalHours * 60 * 60 * 1_000) return;
  await createGuildBackup(guild, actorId, "auto", "نسخة تلقائية");
}

async function scanAutoBackups(guilds: Iterable<Guild>, actorId: string): Promise<void> {
  for (const guild of guilds) {
    try {
      await takeAutoBackupIfDue(guild, actorId);
    } catch (error) {
      logSafe(`Scheduled backup check failed for guild ${guild.id}`, error);
    }
  }
}

const backupCommand = new SlashCommandBuilder()
  .setName("backup")
  .setDescription("إنشاء لقطة احتياطية لبنية السيرفر")
  .addSubcommand((sub) => sub.setName("snapshot").setDescription("حفظ الأدوار والقنوات والصلاحيات الحالية")
    .addStringOption((option) => option.setName("label").setDescription("اسم اختياري للنسخة").setMaxLength(100)));

async function onCommand(interaction: Parameters<NonNullable<SystemixModule["onCommand"]>>[0]): Promise<void> {
  const member = interaction.member as GuildMember;
  const config = await getGuildConfig(interaction.guildId);
  if (!isStaffMember(member, config)) {
    await replyEphemeral(interaction, "إنشاء النسخ مخصص لمالك السيرفر أو فريق الإشراف.");
    return;
  }
  const label = interaction.options.getString("label")?.trim() || "نسخة يدوية";
  const row = await createGuildBackup(interaction.guild, interaction.user.id, "manual", label);
  await replyEphemeral(interaction, row
    ? `تم حفظ لقطة بنيوية #${row.id}: ${row.roleCount} رتبة و${row.channelCount} قناة. لا تتضمن اللقطة رسائل أو أعضاء، والاستعادة غير مفعلة بعد.`
    : "تعذر حفظ النسخة. لم يُجرَ أي تغيير على السيرفر.");
}

export const backupsModule: SystemixModule = {
  name: "backups",
  implemented: true,
  commands: [backupCommand.toJSON()],
  onCommand,
  onReady: async (client) => {
    const actorId = client.user.id;
    await scanAutoBackups(client.guilds.cache.values(), actorId);
  },
  intervals: [{
    name: "scheduled-structural-backups",
    everyMs: 60 * 60 * 1_000,
    run: async (client) => scanAutoBackups(client.guilds.cache.values(), client.user.id),
  }],
};
