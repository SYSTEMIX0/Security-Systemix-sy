import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  guildSubscriptionAudits,
  guildSubscriptions,
  guildSecuritySettings,
  GuildSubscriptionRow,
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
let pingCache: { expiresAt: number; result: boolean } | undefined;
let pingInFlight: Promise<boolean> | undefined;
const PING_CACHE_TTL_MS = 2_000;
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
      _db = drizzle(normalizeDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error instanceof Error ? error.name : "unknown");
      _db = null;
    }
  }
  return _db;
}

/** Cached, non-mutating connectivity check; deliberately exposes only a boolean. */
export async function pingDatabase(): Promise<boolean> {
  const now = Date.now();
  if (pingCache && pingCache.expiresAt > now) return pingCache.result;
  if (pingInFlight) return pingInFlight;
  pingInFlight = (async () => {
    let result = false;
    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        result = true;
      }
    } catch {
      result = false;
    }
    pingCache = { expiresAt: Date.now() + PING_CACHE_TTL_MS, result };
    return result;
  })();
  try {
    return await pingInFlight;
  } finally {
    pingInFlight = undefined;
  }
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

export type SubscriptionPlan = "monthly" | "annual";
export type EffectiveSubscriptionStatus = "active" | "suspended" | "expired";

export type SubscriptionSummary = {
  guildId: string;
  plan: SubscriptionPlan;
  status: EffectiveSubscriptionStatus;
  startsAt: Date;
  endsAt: Date;
  note: string | null;
  updatedByDiscordId: string;
  updatedAt: Date;
};

export function subscriptionDurationDays(plan: SubscriptionPlan): number {
  return plan === "annual" ? 365 : 30;
}

/** A suspended row is always suspended; an active row becomes expired as soon as its end passes. */
export function effectiveSubscriptionStatus(row: Pick<GuildSubscriptionRow, "status" | "endsAt">, now = new Date()): EffectiveSubscriptionStatus {
  if (row.status === "suspended") return "suspended";
  return row.endsAt.getTime() > now.getTime() ? "active" : "expired";
}

/** Renewals extend from a future end date, otherwise start a new period immediately. */
export function subscriptionWindow(current: Pick<GuildSubscriptionRow, "endsAt"> | undefined, plan: SubscriptionPlan, now = new Date()): { startsAt: Date; endsAt: Date } {
  const anchor = current && current.endsAt.getTime() > now.getTime() ? current.endsAt : now;
  const startsAt = new Date(anchor.getTime());
  const endsAt = new Date(startsAt.getTime() + subscriptionDurationDays(plan) * 86_400_000);
  return { startsAt, endsAt };
}

function subscriptionSummary(row: GuildSubscriptionRow, now = new Date()): SubscriptionSummary {
  return {
    guildId: row.guildId,
    plan: row.plan,
    status: effectiveSubscriptionStatus(row, now),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    note: row.note,
    updatedByDiscordId: row.updatedByDiscordId,
    updatedAt: row.updatedAt,
  };
}

export async function listGuildSubscriptions(now = new Date()): Promise<SubscriptionSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(guildSubscriptions).orderBy(desc(guildSubscriptions.updatedAt), desc(guildSubscriptions.guildId));
  return rows.map((row) => subscriptionSummary(row, now));
}

/** Returns no row for an unprovisioned Guild; callers must treat that as non-active. */
export async function getGuildSubscription(guildId: string, now = new Date()): Promise<SubscriptionSummary | undefined> {
  // This path controls automatic punishments, so it must not rely on process-local state.
  // In a multi-instance rollout, a stale active entitlement could otherwise outlive a suspension.
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const [row] = await db.select().from(guildSubscriptions).where(eq(guildSubscriptions.guildId, guildId)).limit(1);
  return row ? subscriptionSummary(row, now) : undefined;
}

export async function renewGuildSubscription(input: {
  guildId: string;
  plan: SubscriptionPlan;
  note?: string;
  actedByDiscordId: string;
  now?: Date;
}): Promise<SubscriptionSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const now = input.now ?? new Date();
  const note = input.note?.trim().slice(0, 300) || null;
  return db.transaction(async (tx) => {
    // Locks the existing row (or InnoDB's primary-key gap for a new row) so concurrent renewals
    // cannot calculate from the same end date. The audit and state change commit or roll back together.
    await tx.execute(sql`SELECT guildId FROM guild_subscriptions WHERE guildId = ${input.guildId} FOR UPDATE`);
    const [current] = await tx.select().from(guildSubscriptions).where(eq(guildSubscriptions.guildId, input.guildId)).limit(1);
    const window = subscriptionWindow(current, input.plan, now);
    const action = current ? "renew" : "activate";
    await tx.insert(guildSubscriptionAudits).values({
      guildId: input.guildId,
      action,
      plan: input.plan,
      previousEndsAt: current?.endsAt ?? null,
      nextEndsAt: window.endsAt,
      note,
      actedByDiscordId: input.actedByDiscordId,
    });
    await tx.insert(guildSubscriptions).values({
      guildId: input.guildId,
      plan: input.plan,
      status: "active",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      note,
      updatedByDiscordId: input.actedByDiscordId,
    }).onDuplicateKeyUpdate({ set: {
      plan: input.plan,
      status: "active",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      note,
      updatedByDiscordId: input.actedByDiscordId,
      updatedAt: now,
    } });
    const [next] = await tx.select().from(guildSubscriptions).where(eq(guildSubscriptions.guildId, input.guildId)).limit(1);
    if (!next) throw new Error("subscription_write_missing");
    return subscriptionSummary(next, now);
  });
}

export async function suspendGuildSubscription(input: { guildId: string; note?: string; actedByDiscordId: string; now?: Date }): Promise<SubscriptionSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT guildId FROM guild_subscriptions WHERE guildId = ${input.guildId} FOR UPDATE`);
    const [current] = await tx.select().from(guildSubscriptions).where(eq(guildSubscriptions.guildId, input.guildId)).limit(1);
    if (!current) throw new Error("subscription_not_found");
    const note = input.note?.trim().slice(0, 300) || current.note;
    await tx.insert(guildSubscriptionAudits).values({
      guildId: input.guildId,
      action: "suspend",
      plan: current.plan,
      previousEndsAt: current.endsAt,
      nextEndsAt: current.endsAt,
      note,
      actedByDiscordId: input.actedByDiscordId,
    });
    await tx.update(guildSubscriptions).set({ status: "suspended", note, updatedByDiscordId: input.actedByDiscordId, updatedAt: now }).where(eq(guildSubscriptions.guildId, input.guildId));
    const [next] = await tx.select().from(guildSubscriptions).where(eq(guildSubscriptions.guildId, input.guildId)).limit(1);
    if (!next) throw new Error("subscription_write_missing");
    return subscriptionSummary(next, now);
  });
}
