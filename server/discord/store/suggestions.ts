import { desc, eq, and } from "drizzle-orm";
import { getDb } from "../../db";
import { suggestions, type SuggestionRow } from "../../../drizzle/schema";

export async function createSuggestion(input: { guildId: string; channelId: string; authorId: string; anonymous: boolean; content: string }): Promise<SuggestionRow> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  // The unique (guildId, suggestionNumber) key prevents duplicate public numbers. Retry the
  // rare concurrent allocation collision without ever querying across guild boundaries.
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await db.select({ suggestionNumber: suggestions.suggestionNumber }).from(suggestions)
      .where(eq(suggestions.guildId, input.guildId)).orderBy(desc(suggestions.suggestionNumber)).limit(1);
    const suggestionNumber = (latest[0]?.suggestionNumber ?? 0) + 1;
    try {
      await db.insert(suggestions).values({ ...input, suggestionNumber, messageId: null, status: "pending", reviewerId: null, reviewNote: null, upvotes: 0, downvotes: 0 });
      const inserted = await db.select().from(suggestions).where(and(eq(suggestions.guildId, input.guildId), eq(suggestions.suggestionNumber, suggestionNumber))).limit(1);
      if (!inserted[0]) throw new Error("suggestion_insert_missing");
      return inserted[0];
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("suggestion_number_allocation_failed");
}

export async function setSuggestionMessage(guildId: string, id: number, messageId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.update(suggestions).set({ messageId }).where(and(eq(suggestions.guildId, guildId), eq(suggestions.id, id)));
}

export async function getSuggestion(guildId: string, number: number): Promise<SuggestionRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const rows = await db.select().from(suggestions).where(and(eq(suggestions.guildId, guildId), eq(suggestions.suggestionNumber, number))).limit(1);
  return rows[0];
}

export async function reviewSuggestion(input: { guildId: string; number: number; reviewerId: string; status: "approved" | "rejected" | "implemented"; note: string | null }): Promise<SuggestionRow | undefined> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  await db.update(suggestions).set({ status: input.status, reviewerId: input.reviewerId, reviewNote: input.note })
    .where(and(eq(suggestions.guildId, input.guildId), eq(suggestions.suggestionNumber, input.number)));
  return getSuggestion(input.guildId, input.number);
}
