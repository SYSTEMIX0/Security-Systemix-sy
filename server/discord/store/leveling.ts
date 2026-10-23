import { and, eq, sql } from "drizzle-orm";
import { memberLevels } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type MemberLevel = { guildId: string; userId: string; xp: number; level: number; messages: number; lastXpAt: Date };

/** Atomically increments only numeric progression data; never accepts or stores message text. */
export async function addMemberXp(guildId: string, userId: string, amount: number, now = new Date()): Promise<MemberLevel> {
  if (!Number.isInteger(amount) || amount < 1 || amount > 200) throw new Error("invalid_xp_amount");
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.insert(memberLevels).values({ guildId, userId, xp: amount, level: 0, messages: 1, lastXpAt: now })
    .onDuplicateKeyUpdate({ set: { xp: sql`${memberLevels.xp} + ${amount}`, messages: sql`${memberLevels.messages} + 1`, lastXpAt: now } });
  const rows = await db.select().from(memberLevels).where(and(eq(memberLevels.guildId, guildId), eq(memberLevels.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) throw new Error("level_row_unavailable");
  return { guildId: row.guildId, userId: row.userId, xp: row.xp, level: row.level, messages: row.messages, lastXpAt: row.lastXpAt };
}

/** Persist a derived social level, scoped to the same guild and user pair. */
export async function updateMemberLevel(guildId: string, userId: string, level: number): Promise<void> {
  if (!Number.isInteger(level) || level < 0) throw new Error("invalid_level");
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.update(memberLevels).set({ level }).where(and(eq(memberLevels.guildId, guildId), eq(memberLevels.userId, userId)));
}
