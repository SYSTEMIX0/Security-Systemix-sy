import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb } from "../db";

// Opt-in only. External hosts such as Render set SYSTEMIX_AUTO_MIGRATE=true so a new,
// empty MySQL database gets the Systemix tables. Drizzle records applied migrations,
// so restarting the service does not apply the same migration twice.
export async function runStartupMigrations(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.SYSTEMIX_AUTO_MIGRATE !== "true") return;
  if (!env.DATABASE_URL?.trim()) {
    console.warn("[Systemix] Database migrations skipped: DATABASE_URL is missing");
    return;
  }
  const db = await getDb();
  if (!db) {
    console.error("[Systemix] Database migrations skipped: database connection could not be created");
    return;
  }
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    console.log("[Systemix] Database migrations: up to date");
  } catch (error) {
    // Report only a code/name; connection errors can contain host details.
    const code = (error as { code?: unknown })?.code;
    const label = typeof code === "string" ? code : error instanceof Error ? error.name : "unknown";
    console.error(`[Systemix] Database migrations failed (${label}); settings saving stays disabled until fixed`);
  }
}
