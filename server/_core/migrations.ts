import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb } from "../db";

export type MigrationState = "not_requested" | "running" | "ready" | "missing_database" | "connection_failed" | "failed";
let migrationState: MigrationState = "not_requested";
let autoMigrationRequested = false;

export function getMigrationStatus(): { state: MigrationState; mode: "automatic" | "external" } {
  return { state: migrationState, mode: autoMigrationRequested ? "automatic" : "external" };
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
    return;
  }
  let db;
  try {
    db = await getDb();
  } catch {
    migrationState = "connection_failed";
    console.error("[Systemix] Database migrations skipped: database connection unavailable");
    return;
  }
  if (!db) {
    migrationState = "connection_failed";
    console.error("[Systemix] Database migrations skipped: database connection unavailable");
    return;
  }
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    migrationState = "ready";
    console.log("[Systemix] Database migrations: up to date");
  } catch {
    migrationState = "failed";
    console.error("[Systemix] Database migrations failed; settings saving stays disabled until fixed");
  }
}
