import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { lockdownStates, type LockdownStateRow } from "../../../drizzle/schema";

export type PreviousSendMessages = "allow" | "deny" | "neutral";
export type LockdownTrigger = "manual" | "anti_nuke" | "anti_raid" | "dashboard";
export type SavedLockdownChannel = { channelId: string; previous: PreviousSendMessages };

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  return db;
}

export async function getLockdownState(guildId: string): Promise<LockdownStateRow | undefined> {
  const db = await requireDb();
  const [row] = await db.select().from(lockdownStates).where(eq(lockdownStates.guildId, guildId)).limit(1);
  return row;
}

export async function listActiveLockdownStates(): Promise<LockdownStateRow[]> {
  const db = await requireDb();
  return db.select().from(lockdownStates).where(eq(lockdownStates.active, true)).orderBy(desc(lockdownStates.updatedAt)).limit(5_000);
}

export type SaveLockdownState = {
  guildId: string;
  active: boolean;
  reason: string | null;
  startedById: string | null;
  trigger: LockdownTrigger;
  channels: SavedLockdownChannel[];
  startedAt: Date | null;
  endsAt: Date | null;
};

export async function saveLockdownState(state: SaveLockdownState): Promise<void> {
  const db = await requireDb();
  await db.insert(lockdownStates).values(state).onDuplicateKeyUpdate({
    set: {
      active: state.active,
      reason: state.reason,
      startedById: state.startedById,
      trigger: state.trigger,
      channels: state.channels,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      updatedAt: new Date(),
    },
  });
}
