import { and, desc, eq, gte, sql } from "drizzle-orm";
import { guildDailyStats } from "../../../drizzle/schema";
import type { DailyStat } from "../../../shared/systemix-api";
import { getDb } from "../../db";

export type StatField = "joins" | "leaves" | "messages" | "modActions" | "threats" | "autoActions";
const STAT_FIELDS: StatField[] = ["joins", "leaves", "messages", "modActions", "threats", "autoActions"];
const STATS_TIMEZONE = "Asia/Riyadh";
const MAX_BUFFERED_KEYS = 20_000;

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function statDay(date = new Date()): string {
  return dayFormatter.format(date);
}

const buffer = new Map<string, Record<StatField, number>>();

/** Adds to an in-memory counter; flushed to MySQL by `flushStats` (called on an interval by the bot core). */
export function bumpStat(guildId: string, field: StatField, amount = 1): void {
  const key = `${guildId}|${statDay()}`;
  let entry = buffer.get(key);
  if (!entry) {
    if (buffer.size >= MAX_BUFFERED_KEYS) return;
    entry = { joins: 0, leaves: 0, messages: 0, modActions: 0, threats: 0, autoActions: 0 };
    buffer.set(key, entry);
  }
  entry[field] += amount;
}

export async function flushStats(): Promise<void> {
  if (buffer.size === 0) return;
  const db = await getDb();
  if (!db) return;
  const pending = [...buffer.entries()];
  buffer.clear();
  for (const [key, values] of pending) {
    const [guildId, day] = key.split("|");
    try {
      await db.insert(guildDailyStats).values({ guildId, day, ...values }).onDuplicateKeyUpdate({
        set: Object.fromEntries(STAT_FIELDS.map((field) => [field, sql`${guildDailyStats[field]} + ${values[field]}`])),
      });
    } catch (error) {
      console.warn("[Stats] Flush failed", error instanceof Error ? error.name : "unknown");
    }
  }
}

/** Returns `days` consecutive days ending today, zero-filled where no data exists. */
export async function listDailyStats(guildId: string, days = 14): Promise<DailyStat[]> {
  const safeDays = Math.max(1, Math.min(90, days));
  const dayKeys: string[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    dayKeys.push(statDay(new Date(Date.now() - offset * 86_400_000)));
  }
  const db = await getDb();
  const rows = db
    ? await db.select().from(guildDailyStats)
      .where(and(eq(guildDailyStats.guildId, guildId), gte(guildDailyStats.day, dayKeys[0])))
      .orderBy(desc(guildDailyStats.day)).limit(safeDays + 1)
    : [];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const pendingToday = buffer.get(`${guildId}|${statDay()}`);
  return dayKeys.map((day) => {
    const row = byDay.get(day);
    const base: DailyStat = {
      day,
      joins: row?.joins ?? 0,
      leaves: row?.leaves ?? 0,
      messages: row?.messages ?? 0,
      modActions: row?.modActions ?? 0,
      threats: row?.threats ?? 0,
      autoActions: row?.autoActions ?? 0,
    };
    if (pendingToday && day === statDay()) {
      for (const field of STAT_FIELDS) base[field] += pendingToday[field];
    }
    return base;
  });
}
