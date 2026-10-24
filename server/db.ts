import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  guildSecuritySettings,
  InsertUser,
  SecurityEventRow,
  GuildSecuritySettingsRow,
  securityEvents,
  users,
} from "../drizzle/schema";
import type { GuildSecurityConfig } from "./discord/config";
import { ENV } from "./_core/env";
import { normalizeDatabaseUrl } from "./_core/databaseUrl";

const monitoredAntiNukeEventTypes = [
  "anti_nuke:channel_create",
  "anti_nuke:channel_delete",
  "anti_nuke:channel_update",
  "anti_nuke:role_create",
  "anti_nuke:role_delete",
  "anti_nuke:role_update",
  "anti_nuke:member_kick",
  "anti_nuke:member_ban",
  "anti_nuke:member_prune",
  "anti_nuke:member_role_update",
  "anti_nuke:webhook_create",
  "anti_nuke:webhook_update",
  "anti_nuke:webhook_delete",
  "anti_nuke:bot_add",
  "anti_nuke:message_bulk_delete",
] as const;

let _db: ReturnType<typeof drizzle> | null = null;
const SETTINGS_CACHE_TTL_MS = 5_000;
const MAX_SETTINGS_CACHE_ENTRIES = 10_000;
const guildSettingsCache = new Map<string, { expiresAt: number; row: GuildSecuritySettingsRow | undefined }>();

function cacheGuildSettings(guildId: string, row: GuildSecuritySettingsRow | undefined): void {
  if (!guildSettingsCache.has(guildId) && guildSettingsCache.size >= MAX_SETTINGS_CACHE_ENTRIES) {
    const oldestKey = guildSettingsCache.keys().next().value;
    if (oldestKey) guildSettingsCache.delete(oldestKey);
  }
  guildSettingsCache.set(guildId, { expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS, row });
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(normalizeDatabaseUrl(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error instanceof Error ? error.name : "unknown");
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  try {
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error instanceof Error ? error.name : "unknown");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getGuildSecuritySettings(guildId: string): Promise<GuildSecuritySettingsRow | undefined> {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.row;
  if (cached) guildSettingsCache.delete(guildId);
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(guildSecuritySettings).where(eq(guildSecuritySettings.guildId, guildId)).limit(1);
  const row = rows[0];
  cacheGuildSettings(guildId, row);
  return row;
}

export async function upsertGuildSecuritySettings(
  guildId: string,
  updatedByDiscordId: string,
  settings: GuildSecurityConfig,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(guildSecuritySettings)
    .values({ guildId, updatedByDiscordId, settings })
    .onDuplicateKeyUpdate({ set: { updatedByDiscordId, settings, updatedAt: new Date() } });
  guildSettingsCache.delete(guildId);
}

export type NewSecurityEvent = {
  guildId: string;
  eventType: string;
  actorId?: string | null;
  targetId?: string | null;
  severity: "low" | "medium" | "high";
  details: Record<string, string | number | boolean | null | string[]>;
};

export async function recordSecurityEvent(event: NewSecurityEvent): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(securityEvents).values({
    guildId: event.guildId,
    eventType: event.eventType,
    actorId: event.actorId ?? null,
    targetId: event.targetId ?? null,
    severity: event.severity,
    details: event.details,
  });
}

export async function listSecurityEvents(guildId: string, limit = 50): Promise<SecurityEventRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return db.select().from(securityEvents)
    .where(eq(securityEvents.guildId, guildId))
    .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
    .limit(safeLimit);
}
