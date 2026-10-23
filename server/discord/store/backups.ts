import { and, desc, eq, inArray } from "drizzle-orm";
import { guildBackups, type GuildBackupRow } from "../../../drizzle/schema";
import { getDb } from "../../db";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  return db;
}

export async function insertGuildBackup(input: {
  guildId: string;
  createdById: string;
  kind: "manual" | "auto" | "pre_incident";
  label: string;
  roleCount: number;
  channelCount: number;
  data: string;
}): Promise<GuildBackupRow> {
  const db = await requireDb();
  const result = await db.insert(guildBackups).values({
    ...input,
    label: input.label.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100),
  });
  const id = Number((result as unknown as [{ insertId: number }])[0]?.insertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("backup_insert_id_missing");
  const [row] = await db.select().from(guildBackups)
    .where(and(eq(guildBackups.guildId, input.guildId), eq(guildBackups.id, id))).limit(1);
  if (!row) throw new Error("backup_insert_not_found");
  return row;
}

export async function listGuildBackups(guildId: string, limit = 20): Promise<GuildBackupRow[]> {
  const db = await requireDb();
  return db.select().from(guildBackups)
    .where(eq(guildBackups.guildId, guildId))
    .orderBy(desc(guildBackups.createdAt), desc(guildBackups.id))
    .limit(Math.max(1, Math.min(50, Math.floor(limit))));
}

export async function getLatestGuildBackup(guildId: string, kind?: "manual" | "auto" | "pre_incident"): Promise<GuildBackupRow | undefined> {
  const db = await requireDb();
  const where = kind
    ? and(eq(guildBackups.guildId, guildId), eq(guildBackups.kind, kind))
    : eq(guildBackups.guildId, guildId);
  const [row] = await db.select().from(guildBackups).where(where)
    .orderBy(desc(guildBackups.createdAt), desc(guildBackups.id)).limit(1);
  return row;
}

/** Keeps the newest N snapshots for one guild, never touching another guild's rows. */
export async function trimGuildBackups(guildId: string, retain: number): Promise<number> {
  const db = await requireDb();
  const safeRetain = Math.max(1, Math.min(30, Math.floor(retain)));
  const rows = await db.select({ id: guildBackups.id }).from(guildBackups)
    .where(eq(guildBackups.guildId, guildId))
    .orderBy(desc(guildBackups.createdAt), desc(guildBackups.id));
  const excessIds = rows.slice(safeRetain).map((row) => row.id);
  if (!excessIds.length) return 0;
  await db.delete(guildBackups).where(and(eq(guildBackups.guildId, guildId), inArray(guildBackups.id, excessIds)));
  return excessIds.length;
}
