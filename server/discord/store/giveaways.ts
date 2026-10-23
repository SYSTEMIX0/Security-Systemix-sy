import { and, eq, lte } from "drizzle-orm";
import { giveaways, giveawayEntries } from "../../../drizzle/schema";
import { getDb } from "../../db";

export async function createGiveaway(input: { guildId: string; channelId: string; hostId: string; prize: string; winnerCount: number; requiredRoleId: string | null; endsAt: Date }): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const result = await db.insert(giveaways).values({ ...input, messageId: null, status: "running", winners: [] });
  const id = Number(result[0].insertId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("giveaway_insert_failed");
  return id;
}

export async function getGiveaway(guildId: string, id: number) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db.select().from(giveaways).where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id))).limit(1);
  return rows[0];
}

export async function setGiveawayMessage(guildId: string, id: number, messageId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.update(giveaways).set({ messageId }).where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id), eq(giveaways.status, "running")));
}

export async function cancelGiveaway(guildId: string, id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.update(giveaways).set({ status: "cancelled" }).where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id), eq(giveaways.status, "running")));
}

function isDuplicateEntry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; errno?: unknown };
  return record.code === "ER_DUP_ENTRY" || Number(record.errno) === 1062;
}

export async function enterGiveaway(guildId: string, id: number, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const row = await getGiveaway(guildId, id);
  if (!row || row.status !== "running" || row.endsAt <= new Date()) return false;
  try {
    await db.insert(giveawayEntries).values({ giveawayId: id, userId });
    return true;
  } catch (error) {
    if (isDuplicateEntry(error)) return false;
    throw error;
  }
}

export async function listGiveawayEntries(guildId: string, id: number): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db.select({ userId: giveawayEntries.userId })
    .from(giveawayEntries)
    .innerJoin(giveaways, eq(giveaways.id, giveawayEntries.giveawayId))
    .where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id), eq(giveawayEntries.giveawayId, id)));
  return rows.map((row) => row.userId);
}

export async function listDueGiveaways(guildId: string, now: Date) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  return db.select().from(giveaways).where(and(eq(giveaways.guildId, guildId), eq(giveaways.status, "running"), lte(giveaways.endsAt, now)));
}

/** Atomically stores the winners with the terminal status; competing end calls cannot overwrite them. */
export async function completeGiveaway(guildId: string, id: number, winners: string[]): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const result = await db.update(giveaways)
    .set({ status: "ended", winners })
    .where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id), eq(giveaways.status, "running")));
  return Number(result[0].affectedRows) === 1;
}
