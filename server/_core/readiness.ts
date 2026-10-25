import { getMigrationStatus } from "./migrations";
import { pingDatabase } from "../db";

export type ReadinessResult = {
  ready: boolean;
  status: "ready" | "not_ready";
  code?: "database_unavailable" | "migrations_pending";
  migration: ReturnType<typeof getMigrationStatus>;
};

export function shouldStartProductionGateway(env: NodeJS.ProcessEnv, readinessReady: boolean): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.SYSTEMIX_ENABLE_PRODUCTION_GATEWAY === "true" && readinessReady;
}

export async function getReadiness(env: NodeJS.ProcessEnv = process.env): Promise<ReadinessResult> {
  const migration = getMigrationStatus();
  let databaseReady = false;
  try {
    databaseReady = await pingDatabase();
  } catch {
    databaseReady = false;
  }
  if (!databaseReady) return { ready: false, status: "not_ready", code: "database_unavailable", migration };

  // In production, DB readiness requires this service's explicitly requested auto-migration
  // to have completed. An external migration process is never represented as successful here.
  if (env.NODE_ENV === "production" && migration.state !== "ready") {
    return { ready: false, status: "not_ready", code: "migrations_pending", migration };
  }
  if (migration.mode === "automatic" && migration.state !== "ready") {
    return { ready: false, status: "not_ready", code: "migrations_pending", migration };
  }
  return { ready: true, status: "ready", migration };
}
