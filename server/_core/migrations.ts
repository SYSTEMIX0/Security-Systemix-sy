import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb } from "../db";

export type MigrationState = "not_requested" | "running" | "ready" | "missing_database" | "connection_failed" | "failed";
let migrationState: MigrationState = "not_requested";
let autoMigrationRequested = false;

export function getMigrationStatus(): { state: MigrationState; mode: "automatic" | "external" } {
  return { state: migrationState, mode: autoMigrationRequested ? "automatic" : "external" };
}

function failClosedInProduction(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production") throw new Error(`systemix_migrations_${migrationState}`);
}

// Explicitly invoked by production startup only; importing this module never writes to DB.
export async function runStartupMigrations(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  autoMigrationRequested = env.SYSTEMIX_AUTO_MIGRATE === "true";
  if (!autoMigrationRequested) {
    migrationState = "not_requested";
    return;
  }
  migrationState = "running";
  if (!env.DATABASE_URL?.trim()) {
    migrationState = "missing_database";
    console.warn("[Systemix] Database migrations skipped: DATABASE_URL is missing");
    failClosedInProduction(env);
    return;
  }
  let db;
  try {
    db = await getDb();
  } catch {
    migrationState = "connection_failed";
    console.error("[Systemix] Database migrations skipped: database connection unavailable");
    failClosedInProduction(env);
    return;
  }
  if (!db) {
    migrationState = "connection_failed";
    console.error("[Systemix] Database migrations skipped: database connection unavailable");
    failClosedInProduction(env);
    return;
  }
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    migrationState = "ready";
    console.log("[Systemix] Database migrations: up to date");
  } catch (error) {
    migrationState = "failed";
    const errorFields = error && typeof error === "object"
      ? error as unknown as Record<string, unknown>
      : {};
    const causeFields = errorFields.cause && typeof errorFields.cause === "object"
      ? errorFields.cause as Record<string, unknown>
      : {};
    const safeCode = (value: unknown) =>
      typeof value === "string" && /^[A-Z0-9_.-]{1,80}$/i.test(value) ? value : undefined;
    console.error("[Systemix] Database migrations failed; settings saving stays disabled until fixed", {
      name: error instanceof Error ? error.name : safeCode(errorFields.name),
      code: safeCode(errorFields.code) ?? safeCode(causeFields.code),
      errno: typeof errorFields.errno === "number" ? errorFields.errno : typeof causeFields.errno === "number" ? causeFields.errno : undefined,
      sqlState: safeCode(errorFields.sqlState) ?? safeCode(causeFields.sqlState),
    });
    failClosedInProduction(env);
  }
}
