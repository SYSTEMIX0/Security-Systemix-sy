import { and, count, desc, eq, gt, gte, lt, max, sql } from "drizzle-orm";
import { modCases, type ModCaseRow } from "../../../drizzle/schema";
import type { ModCase, ModCaseSource } from "../../../shared/systemix-api";
import { getDb } from "../../db";

export type NewModCase = {
  guildId: string;
  type: string;
  targetId: string | null;
  moderatorId: string;
  reason?: string | null;
  durationSeconds?: number | null;
  source?: ModCaseSource;
  active?: boolean;
  metadata?: Record<string, unknown>;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

/** Inserts a case with the next per-guild case number; retries on concurrent number collisions. */
export async function createCase(input: NewModCase): Promise<ModCaseRow> {
  const db = await requireDb();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [{ value }] = await db.select({ value: max(modCases.caseNumber) }).from(modCases).where(eq(modCases.guildId, input.guildId));
    const caseNumber = (value ?? 0) + 1;
    try {
      const result = await db.insert(modCases).values({
        guildId: input.guildId,
        caseNumber,
        type: input.type.slice(0, 24),
        targetId: input.targetId,
        moderatorId: input.moderatorId,
        reason: input.reason ? input.reason.slice(0, 512) : null,
        durationSeconds: input.durationSeconds ?? null,
        source: input.source ?? "manual",
        active: input.active ?? true,
        metadata: input.metadata ?? {},
      });
      const insertId = Number((result as unknown as [{ insertId: number }])[0]?.insertId);
      const [row] = await db.select().from(modCases).where(eq(modCases.id, insertId)).limit(1);
      if (row) return row;
      throw new Error("case_insert_not_found");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      const causeCode = error && typeof error === "object" && "cause" in error && (error as { cause?: { code?: unknown } }).cause?.code;
      if (code === "ER_DUP_ENTRY" || causeCode === "ER_DUP_ENTRY") continue;
      throw error;
    }
  }
  throw new Error("case_number_contention");
}

export type CaseFilters = {
  limit?: number;
  beforeCaseNumber?: number;
  targetId?: string;
  type?: string;
  source?: ModCaseSource;
};

export async function listCases(guildId: string, filters: CaseFilters = {}): Promise<ModCaseRow[]> {
  const db = await requireDb();
  const conditions = [eq(modCases.guildId, guildId)];
  if (filters.beforeCaseNumber) conditions.push(lt(modCases.caseNumber, filters.beforeCaseNumber));
  if (filters.targetId) conditions.push(eq(modCases.targetId, filters.targetId));
  if (filters.type) conditions.push(eq(modCases.type, filters.type));
  if (filters.source) conditions.push(eq(modCases.source, filters.source));
  const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
  return db.select().from(modCases).where(and(...conditions)).orderBy(desc(modCases.caseNumber)).limit(limit);
}

export async function getCase(guildId: string, caseNumber: number): Promise<ModCaseRow | undefined> {
  const db = await requireDb();
  const [row] = await db.select().from(modCases)
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber))).limit(1);
  return row;
}

export async function updateCaseReason(guildId: string, caseNumber: number, reason: string): Promise<boolean> {
  const db = await requireDb();
  const result = await db.update(modCases).set({ reason: reason.slice(0, 512) })
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber)));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0) > 0;
}

export async function setCaseActive(guildId: string, caseNumber: number, active: boolean): Promise<boolean> {
  const db = await requireDb();
  const result = await db.update(modCases).set({ active })
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber)));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0) > 0;
}

export async function countActiveWarnings(guildId: string, targetId: string): Promise<number> {
  const db = await requireDb();
  const [{ value }] = await db.select({ value: count() }).from(modCases).where(and(
    eq(modCases.guildId, guildId),
    eq(modCases.targetId, targetId),
    eq(modCases.type, "warn"),
    eq(modCases.active, true),
  ));
  return Number(value ?? 0);
}

/** Deactivates all active warnings for a member. Returns how many were cleared. */
export async function clearWarnings(guildId: string, targetId: string): Promise<number> {
  const db = await requireDb();
  const result = await db.update(modCases).set({ active: false }).where(and(
    eq(modCases.guildId, guildId),
    eq(modCases.targetId, targetId),
    eq(modCases.type, "warn"),
    eq(modCases.active, true),
  ));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0);
}

/** Closes active cases of one type for one target, scoped strictly to the guild. */
export async function closeActiveCases(guildId: string, targetId: string, type: string): Promise<number> {
  const db = await requireDb();
  const result = await db.update(modCases).set({ active: false }).where(and(
    eq(modCases.guildId, guildId),
    eq(modCases.targetId, targetId),
    eq(modCases.type, type),
    eq(modCases.active, true),
  ));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0);
}

/** Closes active timeout cases regardless of which Systemix module created them. */
export async function closeActiveTimeoutCases(guildId: string, targetId: string): Promise<number> {
  const db = await requireDb();
  const result = await db.update(modCases).set({ active: false }).where(and(
    eq(modCases.guildId, guildId),
    eq(modCases.targetId, targetId),
    eq(modCases.active, true),
    gt(modCases.durationSeconds, 0),
  ));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0);
}

export async function countGuildActiveWarnings(guildId: string): Promise<number> {
  const db = await requireDb();
  const [{ value }] = await db.select({ value: count() }).from(modCases)
    .where(and(eq(modCases.guildId, guildId), eq(modCases.type, "warn"), eq(modCases.active, true)));
  return Number(value ?? 0);
}

export type CaseCountFilters = { source?: ModCaseSource; moderatorId?: string; type?: string; grantId?: string };

/** Counts cases since a timestamp; `grantId` matches delegation metadata. */
export async function countCasesSince(guildId: string, since: Date, filters: CaseCountFilters = {}): Promise<number> {
  const db = await requireDb();
  const conditions = [eq(modCases.guildId, guildId), gte(modCases.createdAt, since)];
  if (filters.source) conditions.push(eq(modCases.source, filters.source));
  if (filters.moderatorId) conditions.push(eq(modCases.moderatorId, filters.moderatorId));
  if (filters.type) conditions.push(eq(modCases.type, filters.type));
  if (filters.grantId) conditions.push(sql`JSON_UNQUOTE(JSON_EXTRACT(${modCases.metadata}, '$.grantId')) = ${filters.grantId}`);
  const [{ value }] = await db.select({ value: count() }).from(modCases).where(and(...conditions));
  return Number(value ?? 0);
}

export function toModCase(row: ModCaseRow): ModCase {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    type: row.type,
    targetId: row.targetId,
    moderatorId: row.moderatorId,
    reason: row.reason,
    durationSeconds: row.durationSeconds,
    active: row.active,
    source: row.source,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}
